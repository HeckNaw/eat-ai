import { useState } from "react";
import { checkAccess, savePasscode } from "../lib/api";

/**
 * Shown only when the deployment sets APP_PASSCODE. It exists to keep the
 * Google spend private, not to keep the restaurant list private — so it's a
 * single field, entered once, remembered on the device.
 */
export function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { ok } = await checkAccess(code.trim());
    setBusy(false);
    if (!ok) {
      setError("Not that one.");
      return;
    }
    savePasscode(code.trim());
    onUnlocked();
  }

  return (
    <div className="panel gate">
      <h1>
        <span className="hi">Hi!</span> Prove your identity.
      </h1>
      <p>Just once on this device. This app belongs to one person and one person only.</p>
      <form className="row" onSubmit={submit} style={{ marginTop: "1rem" }}>
        <input
          className="field"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Passcode"
          autoComplete="current-password"
          enterKeyHint="go"
          autoFocus
        />
        <button className="btn" type="submit" disabled={busy || !code.trim()}>
          {busy ? (
            <span className="thinking">
              <i />
              <i />
              <i />
            </span>
          ) : (
            "Enter"
          )}
        </button>
      </form>
      {error && (
        <div className="hint" style={{ color: "var(--soon)", marginTop: "0.6rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}
