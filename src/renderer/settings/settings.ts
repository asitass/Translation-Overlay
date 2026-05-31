document.addEventListener('DOMContentLoaded', async () => {
  const fontSize = document.getElementById('font-size') as HTMLInputElement;
  const fontSizeLabel = document.getElementById('font-size-label')!;
  const bgOpacity = document.getElementById('bg-opacity') as HTMLInputElement;
  const bgOpacityLabel = document.getElementById('bg-opacity-label')!;
  const displayMode = document.getElementById('display-mode') as HTMLSelectElement;
  const saveBtn = document.getElementById('save-btn')!;
  const status = document.getElementById('status')!;
  const pipelineStatusText = document.getElementById('pipeline-status-text')!;
  const pipelineStatusDiv = document.getElementById('pipeline-status')!;
  const bergamotStatusText = document.getElementById('bergamot-status-text')!;
  const bergamotModelInfo = document.getElementById('bergamot-model-info')!;

  // Listen for pipeline status
  window.electronAPI.onPipelineStatus((status) => {
    console.log('[settings] Pipeline status:', status);
    pipelineStatusText.textContent = String(status);
    if (status === 'running') {
      pipelineStatusDiv.style.color = '#4caf50';
    } else if (status === 'stopped' || status === 'error') {
      pipelineStatusDiv.style.color = '#ef5350';
    } else {
      pipelineStatusDiv.style.color = '#ffc107';
    }
  });

  // Poll bergamot status
  function updateBergamotStatus(bergStatus: string): void {
    bergamotStatusText.textContent = bergStatus;
    const colors: Record<string, string> = {
      ready: '#4caf50',
      loading: '#ffc107',
      error: '#ef5350',
      uninitialized: '#888888',
    };
    bergamotStatusText.style.color = colors[bergStatus] ?? '#888888';

    if (bergStatus === 'ready') {
      bergamotModelInfo.textContent = '(Offline, en↔zh)';
    } else if (bergStatus === 'error') {
      bergamotModelInfo.textContent = '(Check model files)';
    } else {
      bergamotModelInfo.textContent = '';
    }
  }

  async function pollBergamotStatus(): Promise<void> {
    try {
      if (typeof window.electronAPI.bergamotGetStatus === 'function') {
        const bergStatus = await window.electronAPI.bergamotGetStatus();
        updateBergamotStatus(String(bergStatus));
      }
    } catch (err) {
      console.error('[settings] Failed to poll bergamot status:', err);
    }
  }

  // Poll every 3 seconds
  pollBergamotStatus();
  setInterval(pollBergamotStatus, 3000);

  try {
    const config = await window.electronAPI.getConfig() as {
      translation?: {
        primary?: string;
        fallback?: string;
        targetLang?: string;
        ollama?: { baseUrl?: string; model?: string };
      };
      overlay?: { fontSize?: number; backgroundOpacity?: number; displayMode?: string };
    };
    if (config.translation?.primary) {
      (document.getElementById('primary-engine') as HTMLSelectElement).value = config.translation.primary;
    }
    if (config.translation?.fallback) {
      (document.getElementById('fallback-engine') as HTMLSelectElement).value = config.translation.fallback;
    }
    if (config.translation?.targetLang) {
      (document.getElementById('target-lang') as HTMLSelectElement).value = config.translation.targetLang;
    }
    if (config.translation?.ollama?.model) {
      (document.getElementById('ollama-model') as HTMLInputElement).value = config.translation.ollama.model;
    }
    if (config.translation?.ollama?.baseUrl) {
      (document.getElementById('ollama-url') as HTMLInputElement).value = config.translation.ollama.baseUrl;
    }
    if (config.overlay?.fontSize) {
      fontSize.value = String(config.overlay.fontSize);
      fontSizeLabel.textContent = config.overlay.fontSize + 'px';
    }
    if (config.overlay?.backgroundOpacity !== undefined) {
      const pct = Math.round(config.overlay.backgroundOpacity * 100);
      bgOpacity.value = String(pct);
      bgOpacityLabel.textContent = pct + '%';
    }
    if (config.overlay?.displayMode) {
      displayMode.value = config.overlay.displayMode;
    }
    // Lock mode: set radio button from config
    const lockModeValue = (config as Record<string, Record<string, string>>)?.pipeline?.lockMode ?? 'document';
    const lockModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="lockMode"]');
    lockModeRadios.forEach((radio) => {
      radio.checked = radio.value === lockModeValue;
    });
  } catch (err) {
    console.error('[settings] Failed to load config:', err);
  }

  fontSize.addEventListener('input', () => {
    fontSizeLabel.textContent = fontSize.value + 'px';
  });
  bgOpacity.addEventListener('input', () => {
    bgOpacityLabel.textContent = bgOpacity.value + '%';
  });

  saveBtn.addEventListener('click', async () => {
    const lockModeRadio = document.querySelector<HTMLInputElement>('input[name="lockMode"]:checked');
    const newConfig = {
      translation: {
        primary: (document.getElementById('primary-engine') as HTMLSelectElement).value,
        fallback: (document.getElementById('fallback-engine') as HTMLSelectElement).value,
        targetLang: (document.getElementById('target-lang') as HTMLSelectElement).value,
        ollama: {
          model: (document.getElementById('ollama-model') as HTMLInputElement).value,
          baseUrl: (document.getElementById('ollama-url') as HTMLInputElement).value,
        },
      },
      overlay: {
        fontSize: parseInt(fontSize.value),
        backgroundOpacity: parseInt(bgOpacity.value) / 100,
        displayMode: displayMode.value,
      },
      pipeline: {
        lockMode: lockModeRadio?.value ?? 'document',
      },
    };
    try {
      await window.electronAPI.updateConfig(newConfig);
      status.textContent = 'Saved!';
      status.setAttribute('style', 'color: #4caf50');
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (err) {
      status.textContent = 'Failed to save';
      status.setAttribute('style', 'color: #ef5350');
      console.error('[settings] Save failed:', err);
    }
  });
});
