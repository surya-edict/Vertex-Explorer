import React, { useRef, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface TiltCardProps extends React.HTMLAttributes<HTMLElement> {
    children: React.ReactNode;
    className?: string;
    onClick?: (e: React.MouseEvent) => void;
    as?: 'div' | 'button';
    tiltAmount?: number;
}

export function TiltCard({
    children,
    className = '',
    onClick,
    as = 'div',
    tiltAmount = 8,
    ...props
}: TiltCardProps) {
    const ref = useRef<HTMLElement>(null);

    const x = useMotionValue(0);
    const y = useMotionValue(0);

    const mouseXSpring = useSpring(x, { stiffness: 300, damping: 30 });
    const mouseYSpring = useSpring(y, { stiffness: 300, damping: 30 });

    const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], [`${tiltAmount}deg`, `-${tiltAmount}deg`]);
    const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], [`-${tiltAmount}deg`, `${tiltAmount}deg`]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const xPct = (e.clientX - rect.left) / rect.width - 0.5;
        const yPct = (e.clientY - rect.top) / rect.height - 0.5;
        x.set(xPct);
        y.set(yPct);

        // Set CSS custom properties for parallax children
        ref.current.style.setProperty('--mx', String(xPct));
        ref.current.style.setProperty('--my', String(yPct));
    }, [x, y]);

    const handleMouseLeave = useCallback(() => {
        x.set(0);
        y.set(0);
        if (ref.current) {
            ref.current.style.setProperty('--mx', '0');
            ref.current.style.setProperty('--my', '0');
        }
    }, [x, y]);

    const Component = as === 'button' ? motion.button : motion.div;

    return (
        <Component
            ref={ref as any}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{
                rotateX,
                rotateY,
                transformStyle: "preserve-3d",
            }}
            className={className}
            onClick={onClick}
            {...(props as any)}
        >
            {children}
        </Component>
    );
}
