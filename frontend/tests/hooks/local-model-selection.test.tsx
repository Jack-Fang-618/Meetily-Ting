import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useLocalModelSelection } from '../../src/hooks/useLocalModelSelection';
const invoke = mock(async (_command: string, _args?: unknown) => {});
const success = mock(() => 'toast'), error = mock(() => 'toast');
let state: ReturnType<typeof useLocalModelSelection>;
let renderer: ReactTestRenderer;
const selected = mock((_model: string) => {});
function Probe({provider}: {provider: 'localWhisper' | 'parakeet' | 'localQwen'}) {
  state = useLocalModelSelection(provider, selected, true, { invoke, toast: { success, error } }); return null;
}
beforeEach(() => { invoke.mockReset(); invoke.mockImplementation(async () => {}); selected.mockClear(); success.mockClear(); error.mockClear(); });
afterEach(() => { act(() => renderer?.unmount()); });

describe('shared model selection', () => {
  test('every provider commits through the same guarded backend command', async () => {
    for (const provider of ['localWhisper','parakeet','localQwen'] as const) {
      act(() => { renderer = create(<Probe provider={provider} />); });
      await act(async () => { await state.select('test-model'); });
      expect(invoke).toHaveBeenLastCalledWith('select_transcription_model', {provider, model: 'test-model'});
      expect(selected).toHaveBeenLastCalledWith('test-model');
      act(() => renderer.unmount());
    }
  });
  test('does not show a selection until load and save succeed; ignores double clicks', async () => {
    let finish!: () => void;
    invoke.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    act(() => { renderer = create(<Probe provider="localQwen" />); });
    let request!: Promise<void>;
    act(() => { request = state.select('qwen3-asr-0.6b'); });
    expect(state.selecting).toBe('qwen3-asr-0.6b');
    await state.select('different-model');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();
    await act(async () => { finish(); await request; });
    expect(selected).toHaveBeenCalledTimes(1);
    expect(state.selecting).toBeNull();
  });
  test('failed load/save leaves current selection untouched and supports retry', async () => {
    invoke.mockRejectedValueOnce(new Error('disk full'));
    act(() => { renderer = create(<Probe provider="parakeet" />); });
    await act(async () => { await state.select('new'); });
    expect(selected).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1); expect(state.selecting).toBeNull();
    await act(async () => { await state.select('new'); });
    expect(selected).toHaveBeenCalledWith('new');
  });
});
