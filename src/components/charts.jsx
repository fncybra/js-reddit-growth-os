import React from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';

// Register chart.js components once
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Tooltip,
    Legend,
    Filler
);

// Theme colors from CSS variables (hardcoded for chart.js which doesn't read CSS vars)
const COLORS = {
    success: '#10b981',
    danger: '#f43f5e',
    warning: '#f59e0b',
    info: '#0ea5e9',
    accent: '#3b82f6',
    muted: '#71717a',
    textPrimary: '#ededef',
    textSecondary: '#a1a1aa',
    surface: '#141416',
    surfaceElevated: '#1e1e21',
    border: 'rgba(255, 255, 255, 0.08)',
    // Palette for multi-series
    palette: ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'],
};

const darkTooltip = {
    backgroundColor: '#1e1e21',
    titleColor: '#ededef',
    bodyColor: '#a1a1aa',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    cornerRadius: 8,
    padding: 10,
    titleFont: { size: 13, weight: '600' },
    bodyFont: { size: 12 },
};

const darkLegend = {
    labels: {
        color: '#a1a1aa',
        font: { size: 12 },
        padding: 16,
        usePointStyle: true,
        pointStyleWidth: 10,
    },
};

/**
 * StatusDoughnut — shows status distribution (e.g., Active/Suspended/Dead)
 * @param {{ labels: string[], values: number[], colors?: string[] }} props
 */
export function StatusDoughnut({ labels, values, colors, title }) {
    const data = {
        labels,
        datasets: [{
            data: values,
            backgroundColor: colors || COLORS.palette.slice(0, labels.length),
            borderWidth: 0,
            hoverBorderWidth: 2,
            hoverBorderColor: '#ededef',
        }],
    };
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
            legend: { ...darkLegend, position: 'right' },
            tooltip: darkTooltip,
        },
    };
    return (
        <div className="chart-container" style={{ position: 'relative', height: '260px' }}>
            {title && <div style={{ fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '8px', fontWeight: 500 }}>{title}</div>}
            <Doughnut data={data} options={options} />
        </div>
    );
}

/**
 * BarChart — grouped or stacked bar chart
 * @param {{ labels: string[], datasets: Array<{label, data, color?}>, stacked?: boolean }} props
 */
export function BarChart({ labels, datasets, stacked = false, horizontal = false, title }) {
    const data = {
        labels,
        datasets: datasets.map((ds, i) => ({
            label: ds.label,
            data: ds.data,
            backgroundColor: ds.color || COLORS.palette[i % COLORS.palette.length],
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 40,
        })),
    };
    const axis = horizontal ? 'y' : 'x';
    const options = {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: datasets.length > 1 ? { ...darkLegend, position: 'top' } : { display: false },
            tooltip: darkTooltip,
        },
        scales: {
            x: {
                stacked,
                grid: { color: COLORS.border, drawBorder: false },
                ticks: { color: COLORS.textSecondary, font: { size: 11 } },
            },
            y: {
                stacked,
                grid: { color: COLORS.border, drawBorder: false },
                ticks: { color: COLORS.textSecondary, font: { size: 11 } },
                beginAtZero: true,
            },
        },
    };
    return (
        <div className="chart-container" style={{ position: 'relative', height: horizontal ? `${Math.max(200, labels.length * 36)}px` : '280px' }}>
            {title && <div style={{ fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '8px', fontWeight: 500 }}>{title}</div>}
            <Bar data={data} options={options} />
        </div>
    );
}

/**
 * TrendLine — line/area chart for time series
 * @param {{ labels: string[], datasets: Array<{label, data, color?}>, fill?: boolean }} props
 */
export function TrendLine({ labels, datasets, fill = false, title }) {
    const data = {
        labels,
        datasets: datasets.map((ds, i) => ({
            label: ds.label,
            data: ds.data,
            borderColor: ds.color || COLORS.palette[i % COLORS.palette.length],
            backgroundColor: fill
                ? (ds.color || COLORS.palette[i % COLORS.palette.length]) + '20'
                : 'transparent',
            fill,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: ds.color || COLORS.palette[i % COLORS.palette.length],
            borderWidth: 2,
        })),
    };
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: datasets.length > 1 ? { ...darkLegend, position: 'top' } : { display: false },
            tooltip: { ...darkTooltip, mode: 'index', intersect: false },
        },
        scales: {
            x: {
                grid: { color: COLORS.border, drawBorder: false },
                ticks: { color: COLORS.textSecondary, font: { size: 11 }, maxRotation: 45 },
            },
            y: {
                grid: { color: COLORS.border, drawBorder: false },
                ticks: { color: COLORS.textSecondary, font: { size: 11 } },
                beginAtZero: true,
            },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
    };
    return (
        <div className="chart-container" style={{ position: 'relative', height: '280px' }}>
            {title && <div style={{ fontSize: '0.85rem', color: '#a1a1aa', marginBottom: '8px', fontWeight: 500 }}>{title}</div>}
            <Line data={data} options={options} />
        </div>
    );
}

/**
 * MiniSparkline — tiny inline sparkline (no axes, no labels)
 * @param {{ data: number[], color?: string, width?: number, height?: number }} props
 */
export function MiniSparkline({ data, color = COLORS.accent, width = 80, height = 30 }) {
    const chartData = {
        labels: data.map((_, i) => i),
        datasets: [{
            data,
            borderColor: color,
            backgroundColor: color + '20',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            borderWidth: 1.5,
        }],
    };
    const options = {
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
            x: { display: false },
            y: { display: false },
        },
        elements: { point: { radius: 0 } },
    };
    return (
        <div style={{ display: 'inline-block', width, height }}>
            <Line data={chartData} options={options} width={width} height={height} />
        </div>
    );
}

export { COLORS };
