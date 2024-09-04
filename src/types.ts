import type { ReactNode } from 'react';
import type Events from './events';

export interface IHeadManagerEvents {
  [Events.PUSH_TAGS]: {
    containerId: string;
    elements: ReactNode;
  };
  [Events.SYNC_META]: Record<string, unknown>;
}
