import { useId } from '@lomray/consistent-suspense';
import type { FC, PropsWithChildren, ReactNode } from 'react';
import React, { Children, Fragment, useContext, useEffect, useMemo, useRef } from 'react';
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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Compare prop values; style objects are compared by their entries.
 */
const isSameValue = (valueA: unknown, valueB: unknown): boolean => {
  if (valueA === valueB) {
    return true;
  }

  if (!isPlainObject(valueA) || !isPlainObject(valueB)) {
    return false;
  }

  const keys = Object.keys(valueA);

  return (
    keys.length === Object.keys(valueB).length &&
    keys.every((key) => key in valueB && valueA[key] === valueB[key])
  );
};

/**
 * Compare the children of Meta the way the manager reads them: element by element, prop by prop.
 * A parent render creates a new children array for the same tags; skipping it keeps the head untouched.
 */
const isSameTags = (nodesA: ReactNode, nodesB: ReactNode): boolean => {
  if (nodesA === nodesB) {
    return true;
  }

  const unwrap = (nodes: ReactNode): ReactNode =>
    nodes && typeof nodes === 'object' && 'type' in nodes && nodes.type === Fragment
      ? ((nodes.props as Record<string, unknown>).children as ReactNode)
      : nodes;
  const listA: ReactNode[] = [];
  const listB: ReactNode[] = [];

  Children.forEach(unwrap(nodesA), (node) => listA.push(node));
  Children.forEach(unwrap(nodesB), (node) => listB.push(node));

  if (listA.length !== listB.length) {
    return false;
  }

  return listA.every((nodeA, index) => {
    const nodeB = listB[index];

    if (nodeA === nodeB) {
      return true;
    }

    if (
      !nodeA ||
      !nodeB ||
      typeof nodeA !== 'object' ||
      typeof nodeB !== 'object' ||
      !('type' in nodeA) ||
      !('type' in nodeB) ||
      nodeA.type !== nodeB.type ||
      nodeA.key !== nodeB.key
    ) {
      return false;
    }

    const propsA = nodeA.props as Record<string, unknown>;
    const propsB = nodeB.props as Record<string, unknown>;
    const keys = Object.keys(propsA);

    return (
      keys.length === Object.keys(propsB).length &&
      keys.every((key) => key in propsB && isSameValue(propsA[key], propsB[key]))
    );
  });
};

/**
 * Meta tag component
 * @constructor
 */
const Meta: FC<PropsWithChildren> = ({ children }) => {
  const { manager } = useMetaManager();
  const containerId = useId();
  const pushed = useRef<{ children: ReactNode } | null>(null);

  /**
   * Server side push
   */
  if (manager.isServer) {
    manager.pushTags(children, containerId);
  }

  /**
   * Client side push: only when the tags themselves changed
   */
  useEffect(() => {
    if (pushed.current) {
      if (isSameTags(pushed.current.children, children)) {
        return;
      }

      manager.removeTags(containerId);
    }

    pushed.current = { children };
    manager.pushTags(children, containerId);
  }, [manager, children]);

  useEffect(
    () => () => {
      pushed.current = null;
      manager.removeTags(containerId);
    },
    [manager],
  );

  return null;
};

export { Meta, MetaManagerProvider, useMetaManager };
