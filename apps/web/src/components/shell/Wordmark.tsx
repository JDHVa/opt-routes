import { Link } from "@/i18n/navigation";

export function Wordmark() {
  return (
    <Link
      href="/"
      className="flex items-baseline gap-1 rounded-md px-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground"
    >
      RouteOpt
      <span className="num text-micro font-medium text-muted">NL</span>
    </Link>
  );
}
