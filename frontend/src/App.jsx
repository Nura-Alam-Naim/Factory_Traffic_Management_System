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
        <h1>Intelligent Traffic Manager</h1>
        <div className="status-indicators">
          <span className="junction-badge">Junction {junctionId}</span>
          <span className={`connection-badge ${connected ? 'online' : 'offline'}`}>
            {connected ? '● LIVE SYNC' : '○ DISCONNECTED'}
          </span>
        </div>
      </header>

      {error && (
        <div className="alert-banner danger">
          <span>⚠️</span> Connection Error: {error}
        </div>
      )}

      {state && state.mode === 'DEGRADED' && (
        <div className="alert-banner warning pulse">
          <span>⚠️</span> <strong>DEGRADED MODE:</strong> Controller is Offline. Failsafe ALL RED engaged.
        </div>
      )}

      {state && state.mode === 'EMERGENCY' && (
        <div className="alert-banner danger pulse-fast">
          <span>🚨</span> <strong>EMERGENCY PREEMPTION ACTIVE</strong>
        </div>
      )}

      {state && state.mode === 'MANUAL' && (
        <div className="alert-banner info">
          <span>✋</span> <strong>MANUAL OVERRIDE ACTIVE</strong> (Admin: {state.manualLease?.adminId})
        </div>
      )}

      <main className="main-content">
        <section className="viz-section">
          <IntersectionView state={state} />
        </section>

        <aside className="control-section">
          <SimulationPanel junctionId={junctionId} />
          
          <div className="panel glassmorphism mt-4">
            <h3>System Telemetry</h3>
            <pre className="code-block">
              {state ? JSON.stringify({
                mode: state.mode,
                stage: state.stage,
                phase: state.phase,
                queues: Object.fromEntries(
                  Object.entries(state.queues).map(([k, v]) => [k, Object.keys(v).length])
                )
              }, null, 2) : 'Awaiting telemetry...'}
            </pre>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
