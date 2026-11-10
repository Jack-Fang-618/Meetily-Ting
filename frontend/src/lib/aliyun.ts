export interface AliyunConfig { enabled: boolean; default_for_files: boolean; region: string; workspace: string; model: string; keep_dialect: boolean }
export interface AliyunStatus { config: AliyunConfig; has_key: boolean }
export const ALIYUN_MODELS = ['qwen-audio-3.1-asr-flash-filetrans', 'qwen-audio-3.0-asr-flash-filetrans'];
export const ALIYUN_LANGUAGES = new Set(['auto','zh','yue','en','ja','ko','vi','th','id','ms','tl','hi','ar','fr','de','es','pt','ru','it','nl','sv','da','fi','no','el','pl','cs','hu','ro','bg','hr','sk']);

export function cloudImportOptions(status: AliyunStatus) {
  if (!status.config.enabled || !status.has_key) return [];
  return [status.config.model, ...ALIYUN_MODELS.filter(m => m !== status.config.model)]
    .filter(m => ALIYUN_MODELS.includes(m))
    .map(name => ({provider:'aliyun' as const, name, displayName:`☁️ Alibaba Cloud: ${name}`, size_mb:0, destination: status.config.region === 'beijing' ? 'China (Beijing)' : 'Singapore'}));
}

/** A file preference never replaces the live/local provider configuration. */
export function preferredCloudFileKey(status: AliyunStatus | null): string | null {
  if (!status?.config.enabled || !status.config.default_for_files) return null;
  return cloudImportOptions(status).some(m => m.name === status.config.model)
    ? `aliyun:${status.config.model}` : '';
}
