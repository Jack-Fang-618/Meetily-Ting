"""Small synthetic caption translation probe. Key is read from stdin, never logged.
Uses the same prompt and numeric placeholders as the application. No private audio.
"""
import json,time,urllib.request,pathlib,sys,argparse,re
parser=argparse.ArgumentParser()
parser.add_argument('--models',nargs='+',default=['qwen3.8-flash','qwen3.7-plus'])
parser.add_argument('--rounds',type=int,default=3)
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parents[1]
samples=[('english','The meeting may move to Thursday at 2:30, but Alex has not confirmed it. Please keep the API key private.'),('cantonese','我哋聽日下午兩點半再傾啦，不過阿明未覆，唔好當佢應承咗。個budget係二千八百八十蚊，唔係一萬。'),('english','We have not released this feature yet. The deadline is next Friday, and we still need feedback.'),('cantonese','呢個project嘅deadline可能要延後，等我收到feedback先再同你confirm，唔使而家做晒。')]
prompt=json.loads(re.search(r'pub const PROMPT: &str = (".*");', (repo/'frontend/src-tauri/src/caption_translation.rs').read_text()).group(1))
config=json.loads((pathlib.Path.home()/'Library/Application Support/com.ting.dev/aliyun/config.json').read_text())
secret=sys.stdin.read().strip()
if not secret: raise SystemExit('Provide your own Bailian API key through stdin.')
base='https://dashscope.aliyuncs.com' if config['region']=='beijing' else 'https://dashscope-intl.aliyuncs.com'
if config.get('workspace'):base=f"https://{config['workspace']}.{'cn-beijing' if config['region']=='beijing' else 'ap-southeast-1'}.maas.aliyuncs.com"
results=[]
for provider in args.models * args.rounds:
 for mode,text in samples:
  import re
  numbers=[]
  def protect(m):
   token=f'__NUM_{len(numbers)}__';numbers.append(m.group());return token
  protected=re.sub(r'[0-9]+(?:[:.,][0-9]+)*|[零〇一二两兩三四五六七八九十百千万萬亿億]+',protect,text)
  data={'model':provider,'messages':[{'role':'system','content':prompt},{'role':'user','content':protected}],'stream':False}
  if provider=='local':data.update(think=False,options={'temperature':0,'num_predict':256,'num_ctx':4096});url='http://127.0.0.1:11434/api/chat';headers={}
  else:data.update(enable_thinking=False,temperature=0,max_tokens=512);url=base+'/compatible-mode/v1/chat/completions';headers={'Authorization':'Bearer '+secret}
  start=time.monotonic()
  try:
   req=urllib.request.Request(url,json.dumps(data).encode(),{'Content-Type':'application/json',**headers})
   with urllib.request.urlopen(req,timeout=120,context=__import__("ssl").create_default_context(cafile="/etc/ssl/cert.pem")) as r: out=json.load(r)
   result=out['message']['content'] if provider=='local' else out['choices'][0]['message']['content']
   for i,num in enumerate(numbers):
    token=f'__NUM_{i}__'
    if result.count(token)!=1: raise ValueError('number preservation failed')
    result=result.replace(token,num)
   row={'provider':provider,'mode':mode,'source':text,'output':result,'seconds':round(time.monotonic()-start,2)}
   if provider=='local':row.update(load_seconds=round(out.get('load_duration',0)/1e9,2),tokens=out.get('eval_count'))
  except Exception as e:row={'provider':provider,'mode':mode,'error':type(e).__name__, 'status':getattr(e,'code',None),'seconds':round(time.monotonic()-start,2)}
  results.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(results,ensure_ascii=False,indent=2))
