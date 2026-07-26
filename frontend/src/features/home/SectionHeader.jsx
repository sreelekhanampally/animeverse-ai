import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

export function SectionHeader({ title, subtitle, icon, to, action }) {
    const Icon = icon;
    return (
        <div className="mb-4 flex items-end justify-between gap-4">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    {Icon && (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/25 text-white">
                            <Icon className="h-4 w-4" />
                        </span>
                    )}
                    <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">{title}</h2>
                </div>
                {subtitle && <p className="mt-1 text-xs text-muted sm:text-sm">{subtitle}</p>}
            </div>
            {(to || action) && (
                <div className="shrink-0">
                    {action ||
                        (to && (
                            <Link
                                to={to}
                                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-white"
                            >
                                See all <ChevronRight className="h-4 w-4" />
                            </Link>
                        ))}
                </div>
            )}
        </div>
    );
}
