import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptionModelCard } from '../../src/components/TranscriptionModelCard';
const base = { displayName: 'Test model', isSelected: false, onSelect() {}, onDownload() {}, onDelete() {}, onCancel() {} };
describe('shared transcription model card', () => {
  test('selected installed model has original selection treatment and cannot be deleted', () => {
    const html = renderToStaticMarkup(<TranscriptionModelCard {...base} isSelected model={{name:'test',status:'Available',size_mb:900}} />);
    expect(html).toContain('border-blue-500 bg-blue-50'); expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Ready'); expect(html).toContain('Select another model before deleting');
  });
  test('missing model cannot be selected and exposes Download', () => {
    const html = renderToStaticMarkup(<TranscriptionModelCard {...base} model={{name:'test',status:'Missing',size_mb:900}} />);
    expect(html).toContain('disabled="" aria-pressed="false" aria-label="Use Test model"');
    expect(html).toContain('Download'); expect(html).not.toContain('>Ready<');
  });
  test('preparation never invents a download percentage and supports cancellation', () => {
    const html = renderToStaticMarkup(<TranscriptionModelCard {...base} indeterminate isDownloading model={{name:'test',status:{Downloading:{progress:0}},size_mb:900}} />);
    expect(html).toContain('role="progressbar"'); expect(html).not.toContain('aria-valuenow'); expect(html).toContain('Cancel');
  });
  test('errors remain visible with retry', () => {
    const html = renderToStaticMarkup(<TranscriptionModelCard {...base} model={{name:'test',status:{Error:'Disk full'},size_mb:900}} />);
    expect(html).toContain('role="alert"'); expect(html).toContain('Disk full'); expect(html).toContain('Retry download');
  });
  test('known byte progress displays a real percentage and transfer details', () => {
    const html = renderToStaticMarkup(<TranscriptionModelCard {...base} isDownloading progressMessage="50 / 100 MiB · 2 MiB/s" model={{name:'buzz',status:{Downloading:{progress:50}},size_mb:2951}} />);
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('Downloading… 50%');
    expect(html).toContain('50 / 100 MiB · 2 MiB/s');
  });
});
