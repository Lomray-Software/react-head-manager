import { useId } from '@lomray/consistent-suspense';
import type { FC, PropsWithChildren } from 'react';
import React, { useContext, useEffect, useMemo } from 'react';
import Manager from './manager';

interface IMetaManager {
  manager: Manager;
}

/**
 * Global meta manager context
 */
const MetaManagerContext = React.createContext<IMetaManager>({ manager: new Manager() });

/**
 * Global application meta manager provider
 * @constructor
 */
const MetaManagerProvider: FC<PropsWithChildren<IMetaManager>> = ({ children, manager }) => {
  /**
   * Analyze client default meta tags
   */
  useEffect(() => {
    manager.analyzeClientHead();
  }, []);

  const value = useMemo(() => ({ manager }), [manager]);

  return <MetaManagerContext.Provider value={value} children={children} />;
};

const useMetaManager = () => useContext(MetaManagerContext);

/**
 * Meta tag component
 * @constructor
 */
const Meta: FC<PropsWithChildren> = ({ children }) => {
  const { manager } = useMetaManager();
  const containerId = useId();

  /**
   * Server side push
   */
  if (manager.isServer) {
    manager.pushTags(children, containerId);
  }

  /**
   * Client side push
   */
  useEffect(() => {
    manager.pushTags(children, containerId);

    return () => manager.removeTags(containerId);
  }, [manager, children]);

  return null;
};

export { Meta, MetaManagerProvider, useMetaManager };
