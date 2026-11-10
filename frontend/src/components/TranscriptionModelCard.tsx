import { motion } from 'framer-motion';
import { Loader2, Trash2 } from 'lucide-react';
import type { ModelStatus } from '../lib/parakeet';

export interface TranscriptionModelCardProps {
  model: { name: string; status: ModelStatus; size_mb: number };
  displayName: string;
  description?: string;
  icon?: string;
  badge?: string;
  isSelected: boolean;
  isRecommended?: boolean;
  isDownloading?: boolean;
  isCancelling?: boolean;
  isSelecting?: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  progressMessage?: string;
  onSelect: () => void;
  onDownload: () => void;
  onCancel?: () => void;
  onDelete: () => void;
}

/** Shared model interaction, based on Meetily's existing Parakeet card. */
export function TranscriptionModelCard({ model, displayName, description, icon = '📦', badge,
  isSelected, isRecommended, isDownloading, isCancelling, isSelecting, disabled,
  indeterminate, progressMessage, onSelect, onDownload, onCancel, onDelete }: TranscriptionModelCardProps) {
  const available = model.status === 'Available';
  const error = typeof model.status === 'object' && 'Error' in model.status ? model.status.Error : null;
  const corrupted = typeof model.status === 'object' && 'Corrupted' in model.status;
  const progress = typeof model.status === 'object' && 'Downloading' in model.status
    ? Math.max(0, Math.min(100, model.status.Downloading.progress)) : 0;
  const downloading = isDownloading || (typeof model.status === 'object' && 'Downloading' in model.status);
  const locked = disabled || downloading || isCancelling || isSelecting;
  return <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
    className={`relative rounded-lg border-2 transition-all ${isSelected && available ? 'border-blue-500 bg-blue-50' : available ? 'border-gray-200 bg-white hover:border-gray-300' : 'border-gray-200 bg-gray-50'}`}>
    {isRecommended && <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">Recommended</span>}
    <div className="flex items-start gap-4 p-4">
      <button type="button" className="flex-1 min-w-0 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default"
        disabled={!available || !!locked} aria-pressed={isSelected && available} aria-label={`Use ${displayName}`} onClick={onSelect}>
        <span className="flex items-center flex-wrap gap-2 font-semibold text-gray-900">
          <span className="text-2xl" aria-hidden>{icon}</span>{displayName}
          {isSelected && available && <span className="bg-blue-600 text-white px-2 py-0.5 rounded-full text-xs" aria-label="Selected">✓</span>}
          {badge && <span className="bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 text-xs font-normal">{badge}</span>}
        </span>
        {description && <span className="block text-sm text-gray-600 ml-9 mt-1">{description}</span>}
        <span className="block text-xs text-gray-500 ml-9 mt-2">{model.size_mb >= 1000 ? `${(model.size_mb / 1000).toFixed(1)} GB` : `${Math.round(model.size_mb)} MB`}</span>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {isSelecting ? <span role="status" className="text-sm text-blue-600 flex gap-1"><Loader2 className="h-4 w-4 animate-spin" />Loading…</span>
          : available && !downloading && <span className="text-xs font-medium text-green-600 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Ready</span>}
        {available && <button type="button" onClick={onDelete} disabled={!!locked || isSelected} aria-label={`Delete ${displayName}`}
          title={isSelected ? 'Select another model before deleting this one' : 'Delete model to free up space'}
          className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>}
        {!available && !downloading && !isCancelling && <button type="button" onClick={onDownload} disabled={!!locked}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{error || corrupted ? 'Retry download' : 'Download'}</button>}
      </div>
    </div>
    {(downloading || isCancelling) && <div className="mx-4 mb-4 pt-3 border-t border-gray-200" role="status">
      <div className="flex justify-between text-sm text-blue-600 mb-2"><span>{isCancelling ? 'Cancelling…' : indeterminate ? 'Downloading / preparing…' : `Downloading… ${Math.round(progress)}%`}</span>
        {onCancel && <button type="button" disabled={isCancelling} onClick={onCancel} className="text-gray-600 hover:text-red-600">{isCancelling ? 'Cancellation requested' : 'Cancel'}</button>}
      </div>
      <div role="progressbar" aria-label={`Preparing ${displayName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : progress} className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full bg-blue-500 rounded-full ${indeterminate ? 'animate-pulse w-full' : ''}`} style={indeterminate ? undefined : { width: `${progress}%` }} />
      </div>
      {progressMessage && <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap break-words">{progressMessage}</p>}
    </div>}
    {(error || corrupted) && !downloading && <p role="alert" className="text-sm text-red-700 mx-4 mb-4 whitespace-pre-wrap break-words">{error || 'Model files are incomplete. Download again.'}</p>}
  </motion.div>;
}
