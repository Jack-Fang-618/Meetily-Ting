import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, create } from 'react-test-renderer';
import { AliyunSettings } from '../../src/components/AliyunSettings';
import { cloudImportOptions, preferredCloudFileKey, AliyunStatus } from '../../src/lib/aliyun';
const status: AliyunStatus = {has_key:true,config:{enabled:false,default_for_files:false,region:'beijing',workspace:'',model:'qwen-audio-3.1-asr-flash-filetrans',keep_dialect:true}};
describe('user-owned cloud configuration', () => {
  // Radix's closed Select only needs browser timers during renderer cleanup.
  // Popup positioning and keyboard interaction are checked in the browser preview.
  const originalWindow = globalThis.window;
  beforeEach(() => { Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {setTimeout, clearTimeout} }); });
  afterEach(() => { if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else globalThis.window = originalWindow; });
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
  test('saved key is never displayed; save and test run in order with the edited key', async () => {
    const calls: string[] = [];
    let stored = status;
    const call: any = async (command: string, args: any) => {
      calls.push(command);
      if (command === 'aliyun_save_config') {
        expect(args.apiKey).toBe('user-entered-test-key');
        stored = {...status, config: args.config};
      }
      return command === 'aliyun_test_connection' ? 'Access verified.' : stored;
    };
    let r: any;
    await act(async () => { r = create(<AliyunSettings call={call} />); });
    const input = r.root.findByProps({id:'aliyun-key'});
    expect(input.props.value).toBe('');
    expect(calls).toEqual(['aliyun_status']);
    await act(async () => { input.props.onChange({target:{value:'user-entered-test-key'}}); });
    const button = r.root.findAllByType('button').find((b: any) => b.props['data-action'] === 'test');
    expect(button.props.disabled).toBe(false);
    await act(async () => { await button.props.onClick(); });
    expect(calls).toEqual(['aliyun_status', 'aliyun_save_config', 'aliyun_status', 'aliyun_test_connection']);
    expect(input.props.value).toBe('');
    act(() => r.unmount());
  });
  test('failed save retains the draft and never tests old credentials', async () => {
    const calls: string[] = [];
    const call: any = async (command: string) => {
      calls.push(command);
      if (command === 'aliyun_save_config') throw new Error('Credential store unavailable');
      return status;
    };
    let r: any;
    await act(async () => { r = create(<AliyunSettings call={call} />); });
    const input = r.root.findByProps({id:'aliyun-key'});
    await act(async () => { input.props.onChange({target:{value:'test-key'}}); });
    await act(async () => { await r.root.findAllByType('button').find((b: any) => b.props['data-action'] === 'test').props.onClick(); });
    expect(calls).toEqual(['aliyun_status', 'aliyun_save_config']);
    expect(input.props.value).toBe('test-key');
    expect(r.root.findByProps({role:'alert'}).children.join('')).toContain('Credential store unavailable');
    act(() => r.unmount());
  });
  test('repeated clicks cannot start concurrent connection requests', async () => {
    let finish!: (value: string) => void;
    let tests = 0;
    const call: any = async (command: string) => {
      if (command === 'aliyun_test_connection') { tests++; return new Promise<string>(resolve => { finish = resolve; }); }
      return status;
    };
    let r: any;
    await act(async () => { r = create(<AliyunSettings call={call} />); });
    const button = r.root.findAllByType('button').find((b: any) => b.props['data-action'] === 'test');
    let first: Promise<void>;
    await act(async () => { first = button.props.onClick(); await button.props.onClick(); });
    expect(tests).toBe(1);
    expect(button.props.disabled).toBe(true);
    await act(async () => { finish('Verified.'); await first; });
    expect(button.props.disabled).toBe(false);
    act(() => r.unmount());
  });
});
