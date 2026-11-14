import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  help,
  info,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  help?: string;
  info?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center gap-0.5">
        <label htmlFor={htmlFor} className="text-small text-muted">
          {label}
        </label>
        {info ? <span className="-my-1">{info}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-micro text-danger">
          {error}
        </p>
      ) : help ? (
        <p className="text-micro text-muted">{help}</p>
      ) : null}
    </div>
  );
}

export function PanelHeading({
  children,
  info,
}: {
  children: React.ReactNode;
  info?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <h3 className="text-sm font-semibold">{children}</h3>
      {info}
    </div>
  );
}
