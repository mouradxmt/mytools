import { useEffect, useState } from 'react';
import FinanceApp from './Finance.jsx';

// "Personal tools" section. First tool: Finance. Add more here later and the
// switcher appears automatically.
const TOOLS = [
  { id: 'finance', label: '💰 Finance', Component: FinanceApp }
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
