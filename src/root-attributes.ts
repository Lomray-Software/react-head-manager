interface IOwnedValue {
  requested: string | null;
  applied: string | null;
  previous: string | null;
}

type Values = Map<string, string | null>;
type Ownership = Map<string, IOwnedValue>;

/** Track contributions, including individual class tokens and CSS properties. */
class RootAttributes {
  private attributes: Ownership = new Map();

  private classes: Ownership = new Map();

  private styles: Ownership = new Map();

  /** Unchanged props must not overwrite changes made by other code since our last write. */
  private syncValues(
    owned: Ownership,
    desired: Values,
    read: (name: string) => string | null,
    write: (name: string, value: string | null) => void,
    seed: boolean,
    previous: (name: string) => string | null = read,
  ): void {
    for (const name of new Set([...owned.keys(), ...desired.keys()])) {
      const prior = owned.get(name);
      const requested = desired.get(name) ?? null;
      const current = read(name);

      if (!desired.has(name)) {
        if (prior && current === prior.applied) {
          write(name, prior.previous);
        }

        owned.delete(name);
      } else if (!prior) {
        // A false/null prop cannot claim and remove an attribute owned by other code.
        if (requested !== null) {
          const restore = seed ? null : previous(name);

          if (!seed) {
            write(name, requested);
          }

          owned.set(name, {
            requested,
            applied: read(name),
            previous: restore,
          });
        }
      } else if (prior.requested !== requested) {
        if (current === prior.applied) {
          write(name, requested);
          prior.applied = read(name);
        }

        prior.requested = requested;
      }
    }
  }

  /** Seed from the initial snapshot without writing to the DOM. */
  public sync(
    element: HTMLElement,
    attributes: Values,
    style: Record<string, unknown>,
    seed = false,
  ): void {
    const presence = new Map(
      ['class', 'style'].map((name) => [name, element.hasAttribute(name) ? '' : null]),
    );
    const className = attributes.get('class');
    const classes: Values = new Map((className?.match(/\S+/g) ?? []).map((name) => [name, '']));
    const styles: Values = new Map(
      Object.entries(style).map(([name, value]) => [
        name.startsWith('--')
          ? name
          : name
              .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
              .replace(/^ms-/, '-ms-')
              .replace(/^css-float$/, 'float'),
        value === false || value == null ? null : String(value),
      ]),
    );

    // Presence is tracked separately from content so empty manager-created attributes go away.
    for (const name of ['class', 'style']) {
      const value = attributes.get(name);

      if (value != null) {
        attributes.set(name, '');
      }
    }
    this.syncValues(
      this.classes,
      classes,
      (name) => (element.classList.contains(name) ? '' : null),
      (name, value) => element.classList.toggle(name, value !== null),
      seed,
    );
    this.syncValues(
      this.styles,
      styles,
      (name) => {
        const value = element.style.getPropertyValue(name);
        const priority = element.style.getPropertyPriority(name);

        return value ? `${value}${priority ? ` !${priority}` : ''}` : null;
      },
      (name, value) => {
        const important = /\s*!important\s*$/i;

        element.style.setProperty(
          name,
          value?.replace(important, '') ?? '',
          important.test(value ?? '') ? 'important' : '',
        );
      },
      seed,
    );
    this.syncValues(
      this.attributes,
      attributes,
      (name) => {
        const value = element.getAttribute(name);

        return ['class', 'style'].includes(name) && value !== null ? '' : value;
      },
      (name, value) => {
        if (['class', 'style'].includes(name) && element.getAttribute(name)) {
          return;
        }

        if (value === null) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, value);
        }
      },
      seed,
      (name) => (presence.has(name) ? presence.get(name)! : element.getAttribute(name)),
    );
  }
}

export default RootAttributes;
