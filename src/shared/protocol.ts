export const IPC_CHANNELS = {
  PIPELINE_RESULTS: 'pipeline:results',
  PIPELINE_STATUS: 'pipeline:status',
  CONFIG_RESPONSE: 'config:response',
  BERGAMOT_STATUS: 'bergamot:status',
  OVERLAY_CONFIG: 'overlay:config',
} as const;

export const IPC_INVOKES = {
  PIPELINE_START: 'pipeline:start',
  PIPELINE_STOP: 'pipeline:stop',
  CONFIG_GET: 'config:get',
  CONFIG_UPDATE: 'config:update',
  BERGAMOT_GET_STATUS: 'bergamot:get-status',
} as const;
