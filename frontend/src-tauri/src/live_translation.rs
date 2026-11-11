//! Opt-in second audio session for live translated captions; no transcript mutation.
use std::{collections::HashMap,sync::Mutex,time::Duration};
use once_cell::sync::Lazy;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tauri::{AppHandle,Emitter,Runtime};
use futures_util::{SinkExt,StreamExt};
use serde_json::{json,Value};
use base64::Engine;
use rubato::{Resampler,SincFixedIn,SincInterpolationParameters,SincInterpolationType,WindowFunction};
struct AudioConverter { resampler:SincFixedIn<f32> }
impl AudioConverter {
 fn new()->Self { Self {resampler:SincFixedIn::new(1.0/3.0,1.0,SincInterpolationParameters{sinc_len:128,f_cutoff:0.95,interpolation:SincInterpolationType::Linear,oversampling_factor:128,window:WindowFunction::BlackmanHarris2},4800,1).expect("fixed valid resampler configuration")} }
 fn convert(&mut self,samples:&[f32])->Result<Vec<f32>,rubato::ResampleError>{
  self.resampler.process_partial(Some(&[samples]),None).map(|mut channels|channels.remove(0))
 }
}

use tokio_tungstenite::tungstenite::{Message,client::IntoClientRequest};
static AUDIO:Lazy<broadcast::Sender<Option<Vec<f32>>>>=Lazy::new(||broadcast::channel(32).0);
static ACTIVE:Mutex<Option<(String,CancellationToken)>>=Mutex::new(None);
pub fn feed(audio:&[f32]) {if AUDIO.receiver_count()>0 {for part in audio.chunks(4800){let _=AUDIO.send(Some(part.to_vec()));}}}
pub fn finish(){let _=AUDIO.send(None);}
pub fn close(){if let Some((_,token))=ACTIVE.lock().unwrap().take(){token.cancel();}}
#[tauri::command]
pub fn stop_live_translation(session_id:String){let mut active=ACTIVE.lock().unwrap();if active.as_ref().is_some_and(|(id,_)|id==&session_id){if let Some((_,t))=active.take(){t.cancel();}}}

#[derive(Default)]
struct Captions { sources:HashMap<String,String>,translations:HashMap<String,String>,parents:HashMap<String,String>,latest:String }
impl Captions {
 fn update(&mut self,v:&Value)->Option<Value>{
  let kind=v["type"].as_str().unwrap_or_default();let id=v["item_id"].as_str().unwrap_or_default().to_string();
  match kind {
   "conversation.item.created"=>{if let (Some(id),Some(parent))=(v["item"]["id"].as_str(),v["previous_item_id"].as_str()){self.parents.insert(id.into(),parent.into());}},
   "conversation.item.input_audio_transcription.delta"=>{self.sources.entry(id).or_default().push_str(v["delta"].as_str().unwrap_or_default());},
   "conversation.item.input_audio_transcription.completed"=>{self.sources.insert(id,v["transcript"].as_str().unwrap_or_default().into());},
   "response.text.delta"=>{self.latest=id.clone();self.translations.entry(id).or_default().push_str(v["delta"].as_str().unwrap_or_default());},
   _=>return None,
  }
  if self.translations.len()>100 {let last=self.latest.clone();let parent=self.parents.get(&last).cloned();self.translations.retain(|id,_|id==&last);self.parents.retain(|id,_|id==&last);self.sources.retain(|id,_|Some(id)==parent.as_ref());}
  if self.latest.is_empty(){return None;}
  // A source completion may arrive after the next translated sentence starts.
  // Emit that source's own pair instead of attaching it to the latest sentence.
  let updated = match kind {
   "conversation.item.input_audio_transcription.delta" | "conversation.item.input_audio_transcription.completed" => self.parents.iter().find(|(translation,source)|source.as_str()==v["item_id"].as_str().unwrap_or_default() && self.translations.contains_key(*translation)).map(|(id,_)|id).unwrap_or(&self.latest),
   "conversation.item.created" => v["item"]["id"].as_str().and_then(|id|self.translations.get_key_value(id).map(|(key,_)|key)).unwrap_or(&self.latest),
   _ => &self.latest,
  };
  Some(json!({"item_id":updated,"source":self.parents.get(updated).and_then(|p|self.sources.get(p)).cloned().unwrap_or_default(),"text":self.translations.get(updated).cloned().unwrap_or_default()}))
 }
}
#[tauri::command]
pub async fn start_live_translation<R:Runtime>(app:AppHandle<R>,session_id:String,consent:bool,mode:String)->Result<(),String>{
 if !consent{return Err("Live translation requires consent to send recording audio to Bailian.".into());}
 let (_,target)=crate::caption_translation::languages(&mode)?;
 close();let token=CancellationToken::new();*ACTIVE.lock().unwrap()=Some((session_id.clone(),token.clone()));
 let result=async {
 let (endpoint,key)=crate::audio::transcription::aliyun::language_model_connection(&app).map_err(|_|"Configure your Bailian key and region first.")?;
 let host=endpoint.trim_end_matches("/compatible-mode/v1").replacen("https://","wss://",1);
 let mut req=format!("{host}/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime").into_client_request().map_err(|_|"Invalid live translation endpoint")?;
 req.headers_mut().insert("Authorization",format!("Bearer {key}").parse().map_err(|_|"Invalid credential")?);
 let (mut ws,_)=tokio::time::timeout(Duration::from_secs(15),tokio_tungstenite::connect_async(req)).await.map_err(|_|"Live translation connection timed out")?.map_err(|_|"Live translation unavailable: check key, model access and region.")?;
 let config=json!({"type":"session.update","session":{"output_modalities":["text"],"translation":{"language":target},"audio":{"input":{"format":{"type":"pcm","sample_rate":16000}},"output":{"voice":"Tina"}}}});
 tokio::time::timeout(Duration::from_secs(15),async {
  while let Some(message)=ws.next().await {
   let Message::Text(text)=message.map_err(|_|"Live translation connection failed")? else {continue};
   let v:Value=serde_json::from_str(&text).map_err(|_|"Invalid live translation event")?;
   match v["type"].as_str(){Some("session.created")=>ws.send(Message::Text(config.to_string().into())).await.map_err(|_|"Cannot configure live translation")?,Some("session.updated")=>return Ok(()),Some("error")=>return Err("Bailian rejected live translation configuration"),_=>{}}
  } Err("Live translation closed during setup")
 }).await.map_err(|_|"Live translation setup timed out")??;
 if token.is_cancelled(){return Err("Live translation cancelled");}
 let mut audio=AUDIO.subscribe();
 tauri::async_runtime::spawn(async move {
  let mut converter=AudioConverter::new();let mut captions=Captions::default();let mut finishing=false;let mut deadline=tokio::time::Instant::now()+Duration::from_secs(86400);
  let emit=|state:&str,mut payload:Value|{payload["session_id"]=json!(session_id);payload["state"]=json!(state);let _=app.emit("live-translation",payload);};
  emit("ready",json!({"message":"Listening · live audio translation"}));
  loop {
   tokio::select! {
    _=token.cancelled(),if !finishing=>{finishing=true;deadline=tokio::time::Instant::now()+Duration::from_secs(15);if !matches!(tokio::time::timeout(Duration::from_secs(5),ws.send(Message::Text(json!({"type":"session.finish"}).to_string().into()))).await,Ok(Ok(()))){emit("error",json!({"message":"Could not finish live translation; recording is unaffected."}));break;}},
    _=tokio::time::sleep_until(deadline),if finishing=>{emit("error",json!({"message":"Live translation finish timed out; recording is unaffected."}));break;},
    chunk=audio.recv(),if !finishing=>{
     match chunk {
      Ok(Some(samples))=>{
       let mono=match converter.convert(&samples){Ok(audio)=>audio,Err(_)=>{emit("error",json!({"message":"Live translation audio conversion failed; recording continues."}));break;}};
       let bytes:Vec<u8>=mono.iter().flat_map(|s|((s.clamp(-1.0,1.0)*32767.0) as i16).to_le_bytes()).collect();
       let event=json!({"type":"input_audio_buffer.append","audio":base64::engine::general_purpose::STANDARD.encode(bytes)});
       if !matches!(tokio::time::timeout(Duration::from_secs(10),ws.send(Message::Text(event.to_string().into()))).await,Ok(Ok(()))){emit("error",json!({"message":"Live translation send failed; recording continues."}));break;}
      },
      Ok(None)=>{finishing=true;deadline=tokio::time::Instant::now()+Duration::from_secs(15);if !matches!(tokio::time::timeout(Duration::from_secs(5),ws.send(Message::Text(json!({"type":"session.finish"}).to_string().into()))).await,Ok(Ok(()))){emit("error",json!({"message":"Could not finish live translation; recording is unaffected."}));break;}},
      Err(_)=>{emit("error",json!({"message":"Live translation fell behind; restart it to continue."}));break;}
     }
    },
    message=ws.next()=>{
     match message {
      Some(Ok(Message::Text(text)))=>{if let Ok(v)=serde_json::from_str::<Value>(&text){match v["type"].as_str(){Some("error")=>{emit("error",json!({"message":"Bailian live translation failed; recording continues."}));break;},Some("session.finished")=>{emit("ended",json!({"message":"Live translation ended"}));break;},_=>{if let Some(payload)=captions.update(&v){emit("text",payload);}}}}},
      Some(Ok(Message::Ping(p)))=>{let _=tokio::time::timeout(Duration::from_secs(5),ws.send(Message::Pong(p))).await;},
      Some(Ok(Message::Close(_)))|None|Some(Err(_))=>{emit("error",json!({"message":"Live translation disconnected; recording continues."}));break;},_=>{}
     }
    }
   }
  }
  let _=tokio::time::timeout(Duration::from_secs(2),ws.close(None)).await;
 });Ok(())
 }.await;
 result.map_err(str::to_string)
}
#[cfg(test)] mod tests {use super::*;
 #[test] fn late_original_updates_its_own_history_pair(){
  let mut c=Captions::default();
  for (t,s) in [("t1","s1"),("t2","s2")] {
   c.update(&json!({"type":"conversation.item.created","item":{"id":t},"previous_item_id":s}));
   c.update(&json!({"type":"response.text.delta","item_id":t,"delta":t}));
  }
  let p=c.update(&json!({"type":"conversation.item.input_audio_transcription.completed","item_id":"s1","transcript":"first source"})).unwrap();
  assert_eq!(p["item_id"],"t1");assert_eq!(p["text"],"t1");assert_eq!(p["source"],"first source");
 }

 #[test] fn streaming_converter_preserves_duration_after_initial_filter_delay(){let mut converter=AudioConverter::new();let mut count=0;for _ in 0..10 {let audio=converter.convert(&vec![0.1;4800]).unwrap();assert!(audio.iter().all(|s|s.is_finite()));count+=audio.len();}assert!((15900..=16000).contains(&count),"unexpected output duration: {count}");}

 #[test] fn translated_deltas_pair_with_source_even_if_source_arrives_late(){let mut c=Captions::default();c.update(&json!({"type":"conversation.item.created","item":{"id":"t"},"previous_item_id":"s"}));let p=c.update(&json!({"type":"response.text.delta","item_id":"t","delta":"你好"})).unwrap();assert_eq!(p["source"],"");let p=c.update(&json!({"type":"conversation.item.input_audio_transcription.completed","item_id":"s","transcript":"Hello"})).unwrap();assert_eq!(p["source"],"Hello");assert_eq!(p["text"],"你好");}
}
