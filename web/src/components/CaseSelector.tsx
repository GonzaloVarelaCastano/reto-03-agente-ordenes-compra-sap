import type { CaseItem } from "../types/api";
export function CaseSelector({ cases, selected, onSelect }: { cases: CaseItem[]; selected: string | null; onSelect: (id: string) => void }) {
  return <aside className="cases"><h2>Casos</h2><p>Selecciona un caso para incluirlo en el mensaje.</p>{cases.map((item) => <button key={item.id} className={selected === item.id ? "selected" : ""} onClick={() => onSelect(item.id)}>{item.id}</button>)}</aside>;
}
