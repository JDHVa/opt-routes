import { cn } from "@/lib/utils";

export function Num({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("num", className)} {...props} />;
}
