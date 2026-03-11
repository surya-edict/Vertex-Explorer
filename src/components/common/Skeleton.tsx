import './Skeleton.css';

interface SkeletonListProps {
    rows?: number;
    rowHeight?: number;
}

/** GPU-accelerated skeleton loading for DetailsView */
export function SkeletonList({ rows = 10, rowHeight = 28 }: SkeletonListProps) {
    return (
        <div className="skeleton-list">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="skeleton-row" style={{ height: rowHeight }}>
                    <div className="skeleton-bone skeleton-bone--icon" />
                    <div className="skeleton-bone skeleton-bone--name" style={{ maxWidth: 140 + Math.random() * 120 }} />
                    <div className="skeleton-bone skeleton-bone--size" />
                    <div className="skeleton-bone skeleton-bone--date" />
                    <div className="skeleton-bone skeleton-bone--type" />
                </div>
            ))}
        </div>
    );
}

interface SkeletonGridProps {
    cards?: number;
    iconScale?: number;
}

/** GPU-accelerated skeleton loading for GridView */
export function SkeletonGrid({ cards = 12, iconScale = 1 }: SkeletonGridProps) {
    const cardMin = Math.round(130 * iconScale);
    return (
        <div className="skeleton-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))` }}>
            {Array.from({ length: cards }, (_, i) => (
                <div key={i} className="skeleton-card">
                    <div className="skeleton-card-preview" style={{ height: Math.round(80 * iconScale) }} />
                    <div className="skeleton-card-name" />
                </div>
            ))}
        </div>
    );
}
