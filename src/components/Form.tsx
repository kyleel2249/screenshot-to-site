import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

export function Field({ label, hint, error, ...rest }: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} className={inputCls} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? `${id}-d` : undefined} {...rest} />
      {(hint || error) && <p id={`${id}-d`} className={`mt-1 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>{error ?? hint}</p>}
    </div>
  );
}
export function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-secondary p-3 text-sm">
      <ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-md border border-border bg-secondary p-3 text-sm">{children}</div>;
}
export function Page({ title, children, narrow = true }: { title: string; children: ReactNode; narrow?: boolean }) {
  return (
    <div className={`container-x py-12 ${narrow ? "max-w-xl" : ""}`}>
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}
export const PASSWORD_HINT = "At least 12 characters. Use a passphrase you don't use elsewhere.";
