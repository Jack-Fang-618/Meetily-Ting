"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { MeetingSpeakers } from './MeetingSpeakers';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { NotebookPen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMemo } from 'react';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments]);

  return (
    <div className="flex h-full min-w-0 w-full bg-white flex-col relative @container">
      {/* Title area */}
      <div className="flex flex-wrap items-center justify-center gap-2 p-3 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
        />
        {!isRecording && convertedSegments.length > 0 && <Popover key={meetingId}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm"><NotebookPen size={15} className="mr-2" />Context
              {customPrompt.trim() && <span aria-label="Context added" className="ml-2 size-1.5 rounded-full bg-teal-600" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[90vw]">
            <label className="block text-sm font-medium">Summary context
              <textarea rows={4} placeholder="People, terminology, or meeting objectives…"
                className="mt-2 w-full resize-y rounded-md border px-3 py-2 font-normal"
                value={customPrompt} onChange={e => onPromptChange(e.target.value)} />
            </label>
          </PopoverContent>
        </Popover>}
      </div>

      <MeetingSpeakers key={meetingId} meetingId={isRecording || !meetingFolderPath ? undefined : meetingId}>
      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
        />
      </div>

      </MeetingSpeakers>


    </div>
  );
}
