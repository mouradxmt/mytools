import { useEffect, useState } from 'react';
import FinanceApp from './Finance.jsx';
import DebtsApp from './Debts.jsx';

// "Personal tools" section. The switcher appears once there's more than one.
const TOOLS = [
  { id: 'finance', label: '💰 Finance', Component: FinanceApp },
  { id: 'debts', label: '💸 Debts', Component: DebtsApp }
];

export default function PersonalApp() {
  const [tool, setTool] = useState(() => localStorage.getItem('mytools.personalTool') || 'finance');
  useEffect(() => { localStorage.setItem('mytools.personalTool', tool); }, [tool]);

  const active = TOOLS.find((t) => t.id === tool) || TOOLS[0];
  const Active = active.Component;

  return (
    <>
      {TOOLS.length > 1 && (
        <div className="seg-toggle no-print">
          {TOOLS.map((t) => (
            <button key={t.id} className={t.id === active.id ? 'active' : ''} onClick={() => setTool(t.id)}>{t.label}</button>
          ))}
        </div>
      )}
      <Active />
    </>
  );
}
