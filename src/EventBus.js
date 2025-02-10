/**
 * A minimal event emitter to replace AngularJS $broadcast/$on.
 * Listeners are stored by event key.
 */
class SimpleEventEmitter {
  constructor() {
    // Map: eventKey → array of callbacks
    this._listeners = new Map();
  }

  /**
   * Register an event listener.
   * Returns an unsubscribe function.
   */
  on(eventKey, listener) {
    if (!this._listeners.has(eventKey)) {
      this._listeners.set(eventKey, []);
    }
    const listeners = this._listeners.get(eventKey);
    listeners.push(listener);
    // Return an unsubscribe callback
    return () => {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event.
   */
  emit(eventKey, eventObject) {
    const listeners = this._listeners.get(eventKey);
    if (listeners) {
      // We create a shallow copy so that listeners can remove themselves safely.
      [...listeners].forEach(listener => listener(eventObject));
    }
  }
}

// Replace AngularJS events with a simple built-in event emitter.
const eventBus = new SimpleEventEmitter();

export default eventBus;
