import { TranscriptionModelCard as ModelCard } from './TranscriptionModelCard';
import { useLocalModelSelection } from '../hooks/useLocalModelSelection';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ModelStatus,
  ParakeetAPI,
  ParakeetDownloadProgressEvent,
  ParakeetModelInfo,
  getModelDisplayInfo,
  getModelDisplayName
} from '../lib/parakeet';

interface ParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ParakeetModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: ParakeetModelManagerProps) {
  const { selecting, select: selectModel } = useLocalModelSelection('parakeet', onModelSelect, autoSave);
  const [models, setModels] = useState<ParakeetModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [listenersReady, setListenersReady] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [cancellingModels, setCancellingModels] = useState<Set<string>>(new Set());

  // Refs for stable callbacks
  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(new Map());
  const latestStatusByModelRef = useRef<Map<string, ModelStatus>>(new Map());
  const clearCancellingModel = (modelName: string) => {
    setCancellingModels(prev => {
      const next = new Set(prev);
      next.delete(modelName);
      return next;
    });
  };

  // Initialize and load models
  useEffect(() => {
    if (initialized || !listenersReady) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await ParakeetAPI.init();
        const modelList = await ParakeetAPI.getAvailableModels();
        setModels(modelList.map(model => ({
          ...model,
          status: latestStatusByModelRef.current.get(model.name) ?? model.status
        })));

        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Parakeet:', err);
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
  }, [initialized, listenersReady, selectedModel, onModelSelect]);

  // Set up event listeners for download progress
  useEffect(() => {
    let disposed = false;
    let registeredUnlisteners: Array<() => void> = [];

    const setupListeners = async () => {
      console.log('[ParakeetModelManager] Setting up event listeners...');

      const registrations = await Promise.allSettled([
        listen<ParakeetDownloadProgressEvent>(
          'parakeet-model-download-progress',
          (event) => {
            const { modelName, progress, status } = event.payload;
            if (status === 'cancelled') {
              latestStatusByModelRef.current.set(modelName, 'Missing');
              progressThrottleRef.current.delete(modelName);
              clearCancellingModel(modelName);
              setDownloadingModels(prev => {
                const next = new Set(prev);
                next.delete(modelName);
                return next;
              });
              setModels(prevModels =>
                prevModels.map(model =>
                  model.name === modelName
                    ? { ...model, status: 'Missing' as ModelStatus }
                    : model
                )
              );
              toast.info(`${getModelDisplayName(modelName)} download cancelled`, {
                duration: 3000
              });
              return;
            }

            const modelStatus: ModelStatus = status === 'completed'
              ? 'Available'
              : { Downloading: { progress } };
            latestStatusByModelRef.current.set(modelName, modelStatus);

            const now = Date.now();
            const throttleData = progressThrottleRef.current.get(modelName);
            const shouldUpdate = !throttleData ||
              now - throttleData.timestamp > 300 ||
              Math.abs(progress - throttleData.progress) >= 5;

            if (shouldUpdate) {
              console.log(`[ParakeetModelManager] Progress update for ${modelName}: ${progress}%`);
              progressThrottleRef.current.set(modelName, { progress, timestamp: now });
              setModels(prevModels =>
                prevModels.map(model =>
                  model.name === modelName
                    ? { ...model, status: modelStatus }
                    : model
                )
              );
            }
          }
        ),
        listen<{ modelName: string }>(
          'parakeet-model-download-complete',
          (event) => {
            const { modelName } = event.payload;
            const displayInfo = getModelDisplayInfo(modelName);
            const displayName = displayInfo?.friendlyName || modelName;
            latestStatusByModelRef.current.set(modelName, 'Available');
            clearCancellingModel(modelName);

            setModels(prevModels =>
              prevModels.map(model =>
                model.name === modelName
                  ? { ...model, status: 'Available' as ModelStatus }
                  : model
              )
            );

            setDownloadingModels(prev => {
              const newSet = new Set(prev);
              newSet.delete(modelName);
              return newSet;
            });

            // Clean up throttle data
            progressThrottleRef.current.delete(modelName);

            toast.success(`${displayInfo?.icon || '✓'} ${displayName} ready!`, {
              description: 'Model downloaded and ready to use',
              duration: 4000
            });

            // Download completion only marks the model ready.

          }
        ),
        listen<{ modelName: string; error: string }>(
          'parakeet-model-download-error',
          (event) => {
            const { modelName, error } = event.payload;
            const displayInfo = getModelDisplayInfo(modelName);
            const displayName = displayInfo?.friendlyName || modelName;
            latestStatusByModelRef.current.set(modelName, { Error: error });
            clearCancellingModel(modelName);

            setModels(prevModels =>
              prevModels.map(model =>
                model.name === modelName
                  ? { ...model, status: { Error: error } as ModelStatus }
                  : model
              )
            );

            setDownloadingModels(prev => {
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
        )
      ]);

      const unlisteners = registrations.flatMap(result =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      const failedRegistration = registrations.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );

      if (disposed || failedRegistration) {
        unlisteners.forEach(unlisten => unlisten());
        if (!disposed && failedRegistration) {
          const message = failedRegistration.reason instanceof Error
            ? failedRegistration.reason.message
            : typeof failedRegistration.reason === 'string'
              ? failedRegistration.reason
              : 'Failed to listen for Parakeet model updates';
          setError(message);
          setLoading(false);
        }
        return;
      }

      registeredUnlisteners = unlisteners;
      setListenersReady(true);
    };

    setupListeners();

    return () => {
      console.log('[ParakeetModelManager] Cleaning up event listeners...');
      disposed = true;
      registeredUnlisteners.forEach(unlisten => unlisten());
    };
  }, []); // Empty dependency array - listeners use refs for stable callbacks

  const cancelDownload = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    setCancellingModels(prev => new Set([...prev, modelName]));
    try {
      const outcome = await ParakeetAPI.cancelDownload(modelName);
      if (outcome === 'pending') {
        toast.info(`Cancelling ${displayName}...`, {
          description: 'The download is still shutting down. Retry will be available when cleanup completes.',
          duration: 4000
        });
      }
    } catch (err) {
      clearCancellingModel(modelName);
      console.error('Failed to cancel download:', err);
      toast.error('Failed to cancel download', {
        description: err instanceof Error ? err.message : 'Unknown error',
        duration: 4000
      });
    }
  };

  const downloadModel = async (modelName: string) => {
    if (downloadingModels.has(modelName) || cancellingModels.has(modelName)) return;
    clearCancellingModel(modelName);

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      setDownloadingModels(prev => new Set([...prev, modelName]));

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: { progress: 0 } } as ModelStatus }
            : model
        )
      );

      toast.info(`Downloading ${displayName}...`, {
        description: 'This may take a few minutes',
        duration: 5000  // Auto-dismiss after 5 seconds
      });

      await ParakeetAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloadingModels(prev => {
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
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await invoke('delete_transcription_model', { provider: 'parakeet', model: modelName });

      // Refresh models list
      const modelList = await ParakeetAPI.getAvailableModels();
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

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
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

  const recommendedModel = models.find(m =>
    m.name === 'parakeet-tdt-0.6b-v3-int8'
  );
  const otherModels = models.filter(m =>
    m.name !== 'parakeet-tdt-0.6b-v3-int8'
  );

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Recommended Model */}
      {recommendedModel && (
        <ModelCard
          model={recommendedModel}
          displayName={getModelDisplayName(recommendedModel.name)}
          icon={getModelDisplayInfo(recommendedModel.name)?.icon}
          description={getModelDisplayInfo(recommendedModel.name)?.tagline || recommendedModel.description}
          isSelecting={selecting === recommendedModel.name}
          disabled={!!selecting}
          isSelected={selectedModel === recommendedModel.name}
          isRecommended={true}
          onSelect={() => {
            if (recommendedModel.status === 'Available') {
              selectModel(recommendedModel.name);
            }
          }}
          onDownload={() => downloadModel(recommendedModel.name)}
          onCancel={() => cancelDownload(recommendedModel.name)}
          onDelete={() => deleteModel(recommendedModel.name)}
          isDownloading={downloadingModels.has(recommendedModel.name)}
          isCancelling={cancellingModels.has(recommendedModel.name)}
        />
      )}

      {/* Other Models */}
      {otherModels.length > 0 && (
        <div className="space-y-3">
          {otherModels.map(model => (
            <ModelCard
              key={model.name}
              model={model}
          displayName={getModelDisplayName(model.name)}
          icon={getModelDisplayInfo(model.name)?.icon}
          description={getModelDisplayInfo(model.name)?.tagline || model.description}
          isSelecting={selecting === model.name}
          disabled={!!selecting}
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
            />
          ))}
        </div>
      )}

      {/* Helper text */}
      {selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-gray-500 text-center pt-2"
        >
          Using {getModelDisplayName(selectedModel)} for transcription
        </motion.div>
      )}
    </div>
  );
}
