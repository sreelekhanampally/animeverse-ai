import { cn } from "@/utils/cn";

export function Card({ className, children, ...props }) {
    return (
        <div className={cn("card-base p-5", className)} {...props}>
            {children}
        </div>
    );
}

export function CardHeader({ className, children }) {
    return <div className={cn("mb-3 flex items-center justify-between", className)}>{children}</div>;
}

export function CardTitle({ className, children }) {
    return <h3 className={cn("font-display text-base font-semibold text-white", className)}>{children}</h3>;
}
