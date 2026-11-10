import { TranscriptionModelCard as ModelCard } from './TranscriptionModelCard';
import { useLocalModelSelection } from '../hooks/useLocalModelSelection';
import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ModelInfo,
  ModelStatus,
  getModelIcon,
  getModelTagline,
  WhisperAPI
} from '../lib/whisper';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface ModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: ModelManagerProps) {
  const { selecting, select: selectModel } = useLocalModelSelection('localWhisper', onModelSelect, autoSave);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [cancellingModels, setCancellingModels] = useState<Set<string>>(new Set());

  // Refs for stable callbacks

  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(new Map());
  const cancellationReconciliationModelsRef = useRef<Set<string>>(new Set());
  const cancellationReconcileTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Update refs when props change


  // Load persisted downloading state from localStorage
  const getPersistedDownloadingModels = (): Set<string> => {
    try {
      const saved = localStorage.getItem('downloading-models');
      return saved ? new Set<string>(JSON.parse(saved) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  };

  // Persist downloading state to localStorage
  const updateDownloadingModels = (updater: (prev: Set<string>) => Set<string>) => {
    setDownloadingModels(prev => {
      const newSet = updater(prev);
      localStorage.setItem('downloading-models', JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  const clearCancellationReconciliation = (modelName: string) => {
    cancellationReconciliationModelsRef.current.delete(modelName);
    const timer = cancellationReconcileTimersRef.current.get(modelName);
    if (timer !== undefined) {
      clearTimeout(timer);
      cancellationReconcileTimersRef.current.delete(modelName);
    }
    setCancellingModels(prev => {
      const next = new Set(prev);
      next.delete(modelName);
      return next;
    });
  };

  const reconcileCancellation = (modelName: string) => {
    if (cancellationReconciliationModelsRef.current.has(modelName)) return;

    cancellationReconciliationModelsRef.current.add(modelName);
    setCancellingModels(prev => new Set([...prev, modelName]));

    const scheduleNextCheck = () => {
      if (!cancellationReconciliationModelsRef.current.has(modelName)) return;
      const timer = setTimeout(() => {
        cancellationReconcileTimersRef.current.delete(modelName);
        void reconcile();
      }, 1000);
      cancellationReconcileTimersRef.current.set(modelName, timer);
    };

    const reconcile = async () => {
      try {
        const modelList = await WhisperAPI.getAvailableModels();
        if (!cancellationReconciliationModelsRef.current.has(modelName)) return;

        const model = modelList.find(candidate => candidate.name === modelName);

        const isStillDownloading = typeof model?.status === 'object' && 'Downloading' in model.status;
        if (model && !isStillDownloading) {
          clearCancellationReconciliation(modelName);
          updateDownloadingModels(prev => {
            const next = new Set(prev);
            next.delete(modelName);
            return next;
          });
          setModels(modelList);
          progressThrottleRef.current.delete(modelName);
          toast.info(
            model.status === 'Available'
              ? `${getDisplayName(modelName)} download completed before cancellation`
              : `${getDisplayName(modelName)} download cancelled`,
            { duration: 3000 }
          );
          return;
        }
      } catch (err) {
        console.warn('Failed to reconcile pending download cancellation:', err);
      }

      scheduleNextCheck();
    };

    void reconcile();
  };

  // Initialize models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await WhisperAPI.init();
        const modelList = await WhisperAPI.getAvailableModels();

        // Apply persisted downloading states
        const persistedDownloading = getPersistedDownloadingModels();
        const modelsWithDownloadState = modelList.map(model => {
          if (persistedDownloading.has(model.name) && model.status !== 'Available') {
            if (typeof model.status === 'object' && 'Corrupted' in model.status) {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else if (model.status === 'Missing') {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else {
              return { ...model, status: { Downloading: { progress: 0 } } as ModelStatus };
            }
          }
          return model;
        });

        setModels(modelsWithDownloadState);
        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Whisper:', err);
        setError(err instanceof Error ? err.message : 'Failed to load models');
        toast.error('Failed to load transcription models', {
          description: err instanceof Error ? err.message : 'Unknown error',
          duration: 5000
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, selectedModel, onModelSelect]);

  // Set up event listeners for download progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      console.log('[ModelManager] Setting up event listeners...');

      // Download progress with throttling
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            console.log(`[ModelManager] Progress update for ${modelName}: ${progress}%`);
            progressThrottleRef.current.set(modelName, { progress, timestamp: now });

            setModels(prevModels =>
              prevModels.map(model =>
                model.name === modelName
                  ? { ...model, status: { Downloading: { progress } } as ModelStatus }
                  : model
              )
            );
          }
        }
      );

      // Download complete
      unlistenComplete = await listen<{ modelName: string }>(
        'model-download-complete',
        (event) => {
          const { modelName } = event.payload;
          const model = models.find(m => m.name === modelName);
          const displayName = getDisplayName(modelName);

          clearCancellationReconciliation(modelName);

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: 'Available' as ModelStatus }
                : model
            )
          );

          updateDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.success(`${getModelIcon(model?.accuracy || 'Good')} ${displayName} ready!`, {
            description: 'Model downloaded and ready to use',
            duration: 4000
          });

          // Download completion only marks the model ready.

        }
      );

      // Download error
      unlistenError = await listen<{ modelName: string; error: string }>(
        'model-download-error',
        (event) => {
          const { modelName, error } = event.payload;
          const displayName = getDisplayName(modelName);

          clearCancellationReconciliation(modelName);

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: { Error: error } as ModelStatus }
                : model
            )
          );

          updateDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.error(`Failed to download ${displayName}`, {
            description: error,
            duration: 6000,
            action: {
              label: 'Retry',
              onClick: () => downloadModel(modelName)
            }
          });
        }
      );
    };

    setupListeners();

    return () => {
      console.log('[ModelManager] Cleaning up event listeners...');
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
      for (const timer of cancellationReconcileTimersRef.current.values()) {
        clearTimeout(timer);
      }
      cancellationReconcileTimersRef.current.clear();
      cancellationReconciliationModelsRef.current.clear();
    };
  }, []); // Empty dependency array - listeners use refs for stable callbacks

  const cancelDownload = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      const outcome = await WhisperAPI.cancelDownload(modelName);
      if (outcome === 'pending') {
        reconcileCancellation(modelName);
        toast.info(`Cancelling ${displayName}...`, {
          description: 'The download is still shutting down. Retry will be available when cleanup completes.',
          duration: 4000
        });
        return;
      }

      // A worker can finish between the user's click and the cancellation command
      // acquiring its owner. Reconcile instead of overwriting a valid Available state.
      reconcileCancellation(modelName);
    } catch (err) {
      console.error('Failed to cancel download:', err);
      toast.error('Failed to cancel download', {
        description: err instanceof Error ? err.message : 'Unknown error',
        duration: 4000
      });
    }
  };

  const downloadModel = async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    clearCancellationReconciliation(modelName);

    const displayName = getDisplayName(modelName);

    try {
      updateDownloadingModels(prev => new Set([...prev, modelName]));

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: { progress: 0 } } as ModelStatus }
            : model
        )
      );

      toast.info(`Downloading ${displayName}...`, {
        description: 'This may take a few minutes',
        duration: 5000
      });

      await WhisperAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      updateDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      setModels(prev =>
        prev.map(model =>
          model.name === modelName ? { ...model, status: { Error: errorMessage } } : model
        )
      );
    }
  };

  const deleteModel = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      await invoke('delete_transcription_model', { provider: 'localWhisper', model: modelName });

      // Refresh models list
      const modelList = await WhisperAPI.getAvailableModels();
      setModels(modelList);

      toast.success(`${displayName} deleted`, {
        description: 'Model removed to free up space',
        duration: 3000
      });

      // If deleted model was selected, clear selection
      if (selectedModel === modelName && onModelSelect) {
        onModelSelect('');
      }
    } catch (err) {
      console.error('Failed to delete model:', err);
      toast.error(`Failed to delete ${displayName}`, {
        description: err instanceof Error ? err.message : 'Delete failed',
        duration: 4000
      });
    }
  };

  const getDisplayName = (modelName: string): string => {
    const modelNameMapping: { [key: string]: string } = {
      "small": "Small",
      "medium-q5_0": "Medium",
      "large-v3-q5_0": "Large V3 Compressed",
      "large-v3-turbo": "Large V3 Turbo",
      "large-v3": "Large V3"
    };

    const basicModelNames = ["small", "medium-q5_0", "large-v3-q5_0", "large-v3-turbo", "large-v3"];
    if (basicModelNames.includes(modelName)) {
      return modelNameMapping[modelName] || modelName;
    }
    return `Whisper ${modelName}`;
  };

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-gray-100 rounded-lg"></div>
          <div className="h-20 bg-gray-100 rounded-lg"></div>
          <div className="h-20 bg-gray-100 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <p className="text-sm text-red-800">Failed to load models</p>
        <p className="text-xs text-red-600 mt-1">{error}</p>
      </div>
    );
  }

  const basicModelNames = ["small", "medium-q5_0", "large-v3-q5_0", "large-v3-turbo", "large-v3"];
  const basicModels = models.filter(m => basicModelNames.includes(m.name))
    .sort((a, b) => basicModelNames.indexOf(a.name) - basicModelNames.indexOf(b.name));
  const advancedModels = models.filter(m => !basicModelNames.includes(m.name));

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Basic Models */}
      <div className="space-y-3">
        {basicModels.map((model) => {
          const isRecommended = model.name === 'base';
          return (
            <ModelCard
              key={model.name}
              model={model}
              isSelected={selectedModel === model.name}
              isRecommended={isRecommended}
              onSelect={() => {
                if (model.status === 'Available') {
                  selectModel(model.name);
                }
              }}
              onDownload={() => downloadModel(model.name)}
              onCancel={() => cancelDownload(model.name)}
              onDelete={() => deleteModel(model.name)}
              isDownloading={downloadingModels.has(model.name)}
              isCancelling={cancellingModels.has(model.name)}
              displayName={getDisplayName(model.name)}
              icon={getModelIcon(model.accuracy)}
              description={getModelTagline(model.name, model.speed, model.accuracy)}
              isSelecting={selecting === model.name}
              disabled={!!selecting}
            />
          );
        })}
      </div>

      {/* Advanced Models */}
      {advancedModels.length > 0 && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="advanced-models">
            <AccordionTrigger>
              <span className='text-lg'>Advanced Models</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-4">
                {advancedModels.map((model) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    isSelected={selectedModel === model.name}
                    isRecommended={false}
                    onSelect={() => {
                      if (model.status === 'Available') {
                        selectModel(model.name);
                      }
                    }}
                    onDownload={() => downloadModel(model.name)}
                    onCancel={() => cancelDownload(model.name)}
                    onDelete={() => deleteModel(model.name)}
                    isDownloading={downloadingModels.has(model.name)}
                    isCancelling={cancellingModels.has(model.name)}
                    displayName={getDisplayName(model.name)}
              icon={getModelIcon(model.accuracy)}
              description={getModelTagline(model.name, model.speed, model.accuracy)}
              isSelecting={selecting === model.name}
              disabled={!!selecting}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Helper text */}
      {selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-gray-500 text-center pt-2"
        >
          Using {getDisplayName(selectedModel)} for transcription
        </motion.div>
      )}
    </div>
  );
}
