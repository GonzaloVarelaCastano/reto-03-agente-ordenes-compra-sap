export function ConfirmationPanel({ motivos, onConfirm, onReject, disabled }: { motivos: string[]; onConfirm: () => void; onReject: () => void; disabled: boolean }) {
  return <section className="confirmation"><h3>Confirmación humana requerida</h3><p>La orden no se creará hasta recibir tu decisión explícita.</p><ul>{motivos.map((motivo) => <li key={motivo}>{motivo}</li>)}</ul><div><button disabled={disabled} onClick={onConfirm}>Confirmar operación</button><button disabled={disabled} className="secondary" onClick={onReject}>Rechazar</button></div></section>;
}
