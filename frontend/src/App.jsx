import React from 'react';
import { useJunctionStatus } from './hooks/useJunctionStatus';
import { IntersectionView } from './components/IntersectionView';
import { SimulationPanel } from './components/SimulationPanel';
import './index.css';

function App() {
  const junctionId = 'A'; // Hardcoded for this assessment demo
  const { state, history, connected, error } = useJunctionStatus(junctionId);

  return (
    <div className="app-container">
      <header className="app-header glassmorphism">
        <h1>Factory Traffic Monitor</h1>
        <div className="status-indicators">
          <span className={`connection-badge ${connected ? 'online' : 'offline'}`}>
            {connected ? '● Live SSE' : '○ Disconnected'}
          </span>
          <span className="junction-badge">Junction {junctionId}</span>
        </div>
      </header>

      {error && (
        <div className="alert-banner error">
          ⚠️ Connection Error: {error}
        </div>
      )}

      {state && state.mode === 'DEGRADED' && (
        <div className="alert-banner warning pulse">
          ⚠️ DEGRADED MODE: Controller is Offline or Unresponsive. Failsafe ALL RED engaged.
        </div>
      )}

      {state && state.mode === 'EMERGENCY' && (
        <div className="alert-banner danger pulse-fast">
          🚨 EMERGENCY PREEMPTION ACTIVE 🚨
        </div>
      )}

      {state && state.mode === 'MANUAL' && (
        <div className="alert-banner info">
          ✋ MANUAL OVERRIDE ACTIVE (Admin: {state.manualLease?.adminId})
        </div>
      )}

      <main className="main-content">
        <section className="viz-section">
          <IntersectionView state={state} />
        </section>

        <aside className="control-section">
          <SimulationPanel junctionId={junctionId} />
          
          <div className="panel data-panel glassmorphism mt-4">
            <h3>Live Data</h3>
            <pre className="code-block">
              {state ? JSON.stringify({
                mode: state.mode,
                stage: state.stage,
                phase: state.phase,
                queues: Object.fromEntries(
                  Object.entries(state.queues).map(([k, v]) => [k, Object.keys(v).length])
                )
              }, null, 2) : 'Loading...'}
            </pre>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
