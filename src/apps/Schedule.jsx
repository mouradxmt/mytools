import { useEffect, useMemo, useState } from 'react';
import { useVault } from '../vault/VaultContext.jsx';
import { useEncryptedState } from '../vault/useEncryptedState.js';
import * as backend from '../sync/supabase.js';
import { makeRotationLookup } from '../lib/rotation.js';
import CalendarApp from './Calendar.jsx';
import RemoteRotationApp from './RemoteRotation.jsx';

// Combined Calendar + Remote Rotation. The month view overlays the shared
// rotation (who's in the office each day, with your days highlighted); the
// rotation view keeps the full weekly schedule + admin/team tools.
export default function ScheduleApp() {
  const { session } = useVault();
  const [view, setView] = useState(() => localStorage.getItem('mytools.scheduleView') || 'month');
  const [overlay] = useEncryptedState('remote/localOverlay', { meName: '', startDayOverride: null });

  const [rotCfg, setRotCfg] = useState(null);
  const [access, setAccess] = useState(false);

  useEffect(() => { localStorage.setItem('mytools.scheduleView', view); }, [view]);

  // Load the shared rotation config for the calendar overlay (read-only).
  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        const { role, missing } = await backend.getMyRole();
        if (!alive) return;
        if (missing || role === 'none') { setAccess(false); setRotCfg(null); return; }
        setAccess(true);
        const row = await backend.getSharedRotation();
        if (alive) setRotCfg(row?.config || null);
      } catch {
        if (alive) { setAccess(false); setRotCfg(null); }
      }
    })();
    return () => { alive = false; };
  }, [session, view]); // refresh when returning to the month view

  const rotationForDate = useMemo(
    () => (access && rotCfg ? makeRotationLookup(rotCfg, overlay.meName) : null),
    [access, rotCfg, overlay.meName]
  );

  return (
    <>
      <div className="seg-toggle no-print">
        <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>📅 Month</button>
        <button className={view === 'rotation' ? 'active' : ''} onClick={() => setView('rotation')}>🗓️ Rotation</button>
      </div>

      {view === 'month' ? (
        <>
          {access && !rotationForDate && (
            <div className="hint" style={{ marginBottom: 10 }}>
              Tip: pick “I am …” in the Rotation view to highlight your office days here.
            </div>
          )}
          <CalendarApp rotationForDate={rotationForDate} />
        </>
      ) : (
        <RemoteRotationApp />
      )}
    </>
  );
}
