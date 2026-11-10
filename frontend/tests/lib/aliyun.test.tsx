import { describe, expect, test } from 'bun:test';
import { act, create } from 'react-test-renderer';
import { AliyunSettings } from '../../src/components/AliyunSettings';
import { cloudImportOptions, preferredCloudFileKey, AliyunStatus } from '../../src/lib/aliyun';
const status: AliyunStatus = {has_key:true,config:{enabled:false,default_for_files:false,region:'beijing',workspace:'',model:'qwen-audio-3.1-asr-flash-filetrans',keep_dialect:true}};
describe('user-owned cloud configuration', () => {
  test('no cloud choices without both explicit opt-in and own saved key', () => {
    expect(cloudImportOptions(status)).toEqual([]);
    expect(cloudImportOptions({...status,has_key:false,config:{...status.config,enabled:true}})).toEqual([]);
    expect(cloudImportOptions({...status,config:{...status.config,enabled:true}})).toHaveLength(2);
  });
  test('cloud default is explicit and a missing key cannot silently select another model', () => {
    expect(preferredCloudFileKey(status)).toBeNull();
    const configured = {...status,config:{...status.config,enabled:true,default_for_files:true}};
    expect(preferredCloudFileKey(configured)).toBe('aliyun:' + configured.config.model);
    expect(preferredCloudFileKey({...configured,has_key:false})).toBe('');
    expect(preferredCloudFileKey({...configured,config:{...configured.config,default_for_files:false}})).toBeNull();
  });
  test('saved key stays absent from input and draft changes disable connection test', async () => {
    const calls:string[]=[];
    const call:any=async (command:string) => { calls.push(command); return status; };
    let r:any;
    await act(async () => { r=create(<AliyunSettings call={call} />); });
    const input=r.root.findByProps({id:'aliyun-key'});
    expect(input.props.value).toBe('');
    expect(calls).toEqual(['aliyun_status']);
    await act(async () => { input.props.onChange({target:{value:'user-entered-test-key'}}); });
    const button=r.root.findAllByType('button').find((b:any)=>b.children.join('')==='Test saved connection');
    expect(button.props.disabled).toBe(true);
    act(()=>r.unmount());
  });
});
