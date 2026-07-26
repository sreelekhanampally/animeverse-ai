import { useState } from "react";
import { cn } from "@/utils/cn";

export function LazyImage({
    src,
    alt = "",
    className,
    wrapperClassName,
    fallback,
    ...rest
}) {
    const [loaded, setLoaded] = useState(false);
    const [errored, setErrored] = useState(false);

    return (
        <div className={cn("relative overflow-hidden", wrapperClassName)}>
            {!loaded && !errored && (
                <div className="absolute inset-0 skeleton" aria-hidden="true" />
            )}
            {errored ? (
                fallback || (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/25 to-accent/20 text-xs text-white/60">
                        {alt || "Image"}
                    </div>
                )
            ) : (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setLoaded(true)}
                    onError={() => setErrored(true)}
                    className={cn(
                        "h-full w-full object-cover transition-opacity duration-500",
                        loaded ? "opacity-100" : "opacity-0",
                        className
                    )}
                    {...rest}
                />
            )}
        </div>
    );
}
