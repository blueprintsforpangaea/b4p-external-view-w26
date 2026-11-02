import { Component } from 'react';
import { clearInventoryCache } from '../inventoryCache';

// Last line of defence: a render error shows a way out instead of a blank page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }



  componentDidCatch(error) {
    // A bad saved inventory must never brick the device: drop it so Reload starts clean.
    clearInventoryCache();
    // eslint-disable-next-line no-console
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="main">
        <div className="state state--error" role="alert">
          <h1 className="page-title">Something went wrong on this page</h1>
          <p className="state__text">Your list is saved on this device. Reload to keep going.</p>
          <a
            className="btn btn--primary"
            href="#/"
            onClick={() => {
              window.location.hash = '#/';
              window.location.reload();
            }}
          >
            Reload
          </a>
        </div>
      </main>
    );
  }
}
