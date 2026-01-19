// Global State
let allData = [];
let loadingsData = [];
let filteredData = [];
let selectedCountry = null;
let currentCluster = 'all';

// Constants
const CLUSTER_COLORS = {
    0: 'var(--c0)',
    1: 'var(--c1)',
    2: 'var(--c2)'
};

const CLUSTER_NAMES = {
    0: 'Industrial Growth',
    1: 'Service Expansion',
    2: 'Agri-Transition'
};

const SECTORS = ['Agri', 'Manu', 'Services'];
const SECTOR_LABELS = ['Agriculture', 'Manufacturing', 'Services'];

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        allData = data.countries;
        loadingsData = data.loadings;
        filteredData = [...allData];
        
        initDashboard();
    } catch (error) {
        console.error('Error loading data:', error);
    }
});

function initDashboard() {
    // Initialize Filter
    const filter = document.getElementById('cluster-filter');
    filter.addEventListener('change', (e) => {
        currentCluster = e.target.value;
        updateFilters();
    });

    const resetBtn = document.getElementById('reset-selection');
    resetBtn.addEventListener('click', () => {
        selectedCountry = null;
        updateSelectionHeader();
        renderAll();
    });

    // Initialize SVGs only once to enable transitions
    const charts = ['map-viz', 'pca-viz', 'bar-viz', 'history-viz'];
    charts.forEach(id => {
        const container = document.getElementById(id);
        const width = container.clientWidth;
        const height = container.clientHeight;
        const svg = d3.select(`#${id}`).append('svg')
            .attr('width', width)
            .attr('height', height)
            .attr('id', `${id}-svg`);
        
        if (id === 'bar-viz' || id === 'history-viz') {
            svg.append('g').attr('class', 'chart-g');
            svg.append('g').attr('class', 'x-axis');
            svg.append('g').attr('class', 'y-axis');
            svg.append('text').attr('class', 'chart-title');
            svg.append('text').attr('class', 'placeholder');
        }
    });

    // Initial Render
    renderAll();

    // Resize Handler
    window.addEventListener('resize', debounce(() => {
        // Redraw SVGs with new sizes
        charts.forEach(id => {
            const container = document.getElementById(id);
            d3.select(`#${id}-svg`)
                .attr('width', container.clientWidth)
                .attr('height', container.clientHeight);
        });
        renderAll();
    }, 250));
}

function updateSelectionHeader() {
    const display = document.getElementById('selected-country-display');
    if (selectedCountry) {
        display.innerText = selectedCountry.name;
        display.classList.add('highlight');
    } else {
        display.innerText = 'N/A';
        display.classList.remove('highlight');
    }
}

function updateFilters() {
    if (currentCluster === 'all') {
        filteredData = [...allData];
    } else {
        filteredData = allData.filter(d => d.cluster_id == currentCluster);
    }
    
    document.getElementById('stat-count').innerText = filteredData.length;
    renderAll();
}

function renderAll() {
    renderMap();
    renderPCA();
    renderBarChart();
    renderHistory();
}

// --- VISUALIZATIONS ---

async function renderMap() {
    const svg = d3.select('#map-viz-svg');
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    
    // Check if map is already rendered to avoid reloading GeoJSON
    if (svg.select('.countries-g').empty()) {
        svg.append('g').attr('class', 'countries-g');
    }
    const countriesG = svg.select('.countries-g');

    const projection = d3.geoMercator()
        .scale(width / 6.5)
        .translate([width / 2.2, height / 1.5]);

    const path = d3.geoPath().projection(projection);

    // Load GeoJSON
    const world = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    const countries = topojson.feature(world, world.objects.countries);

    const mapDataMap = new Map(allData.map(d => [d.name, d]));

    countriesG.selectAll('path')
        .data(countries.features)
        .join('path')
        .attr('d', path)
        .attr('class', 'country')
        .on('mouseover', (event, d) => {
            const normalizedName = getNormalizedName(d.properties.name);
            const data = mapDataMap.get(normalizedName);
            if (!data) return;
            showTooltip(event, `<strong>${data.name}</strong><br>Growth: ${data.gdp_growth.toFixed(1)}%<br>Cluster: ${data.cluster}`);
            d3.select(event.currentTarget).transition().duration(200).attr('stroke', 'white').attr('stroke-width', 1.5);
        })
        .on('mouseout', (event, d) => {
            hideTooltip();
            const normalizedName = getNormalizedName(d.properties.name);
            if (!selectedCountry || selectedCountry.name !== normalizedName) {
                d3.select(event.currentTarget).transition().duration(200).attr('stroke', 'var(--bg-color)').attr('stroke-width', 0.5);
            }
        })
        .on('click', (event, d) => {
            const normalizedName = getNormalizedName(d.properties.name);
            const data = mapDataMap.get(normalizedName);
            if (data) {
                selectedCountry = data;
                updateSelectionHeader();
                renderAll();
            }
        })
        .transition().duration(500)
        .attr('fill', d => {
            const normalizedName = getNormalizedName(d.properties.name);
            const countryData = mapDataMap.get(normalizedName);
            if (!countryData) return '#1e293b';
            const isFiltered = filteredData.find(f => f.name === normalizedName);
            if (!isFiltered) return '#1e293b';
            return CLUSTER_COLORS[countryData.cluster_id];
        })
        .attr('stroke', d => {
            const normalizedName = getNormalizedName(d.properties.name);
            return (selectedCountry && selectedCountry.name === normalizedName) ? '#fff' : 'var(--bg-color)';
        })
        .attr('stroke-width', d => {
            const normalizedName = getNormalizedName(d.properties.name);
            return (selectedCountry && selectedCountry.name === normalizedName) ? 4 : 0.5;
        });
}

function renderPCA() {
    const svg = d3.select('#pca-viz-svg');
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    const margin = {top: 20, right: 20, bottom: 40, left: 40};
    
    if (svg.select('.grid-g').empty()) {
        svg.append('g').attr('class', 'grid-g');
        svg.append('g').attr('class', 'axes-g');
        svg.append('g').attr('class', 'loadings-g');
        svg.append('g').attr('class', 'dots-g');
        svg.append('g').attr('class', 'legend-g');
    }

    const x = d3.scaleLinear()
        .domain(d3.extent(allData, d => d.pc1)).nice()
        .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
        .domain(d3.extent(allData, d => d.pc2)).nice()
        .range([height - margin.bottom, margin.top]);

    // Axes
    const axesG = svg.select('.axes-g');
    axesG.selectAll('*').remove();
    axesG.append('g')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(5))
        .attr('class', 'axis-label');

    axesG.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(5))
        .attr('class', 'axis-label');

    // Grid lines
    const gridG = svg.select('.grid-g');
    gridG.selectAll('*').remove();
    gridG.selectAll('line.x')
        .data(x.ticks(5))
        .join('line')
        .attr('x1', d => x(d)).attr('x2', d => x(d))
        .attr('y1', margin.top).attr('y2', height - margin.bottom)
        .attr('class', 'grid-line');

    gridG.selectAll('line.y')
        .data(y.ticks(5))
        .join('line')
        .attr('y1', d => y(d)).attr('y2', d => y(d))
        .attr('x1', margin.left).attr('x2', width - margin.right)
        .attr('class', 'grid-line');

    // PCA Arrows (Loadings)
    const loadingsG = svg.select('.loadings-g');
    loadingsG.selectAll('*').remove();
    const scaleFactor = 2.0;

    loadingsG.selectAll('line')
        .data(loadingsData)
        .join('line')
        .attr('x1', x(0))
        .attr('y1', y(0))
        .attr('x2', d => x(d.x * scaleFactor))
        .attr('y2', d => y(d.y * scaleFactor))
        .attr('stroke', '#ef4444')
        .attr('stroke-width', 2)
        .attr('marker-end', 'url(#arrowhead)');

    loadingsG.selectAll('text')
        .data(loadingsData)
        .join('text')
        .attr('x', d => x(d.x * scaleFactor * 1.1))
        .attr('y', d => y(d.y * scaleFactor * 1.1))
        .attr('fill', '#ef4444')
        .attr('font-size', '10px')
        .attr('font-weight', 'bold')
        .attr('text-anchor', 'middle')
        .text(d => d.feature.replace('Delta_', ''));

    // Arrowhead Marker
    if (svg.select('#arrowhead').empty()) {
        svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 8)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .append('path')
            .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
            .attr('fill', '#ef4444');
    }

    // Dots
    svg.select('.dots-g').selectAll('.dot')
        .data(allData)
        .join('circle')
        .attr('class', 'dot')
        .attr('fill', d => CLUSTER_COLORS[d.cluster_id])
        .on('mouseover', (event, d) => {
            showTooltip(event, `<strong>${d.name}</strong><br>Type: ${d.cluster}`);
        })
        .on('mouseout', hideTooltip)
        .on('click', (event, d) => {
            selectedCountry = d;
            updateSelectionHeader();
            renderAll();
        })
        .transition().duration(500)
        .attr('cx', d => x(d.pc1))
        .attr('cy', d => y(d.pc2))
        .attr('r', d => (selectedCountry && selectedCountry.name === d.name) ? 14 : 6)
        .attr('stroke', d => (selectedCountry && selectedCountry.name === d.name) ? '#fff' : 'black')
        .attr('stroke-width', d => (selectedCountry && selectedCountry.name === d.name) ? 4 : 0.5)
        .attr('opacity', d => {
            const isFiltered = filteredData.find(f => f.name === d.name);
            return isFiltered ? 0.9 : 0.1;
        });

    // Legend
    const legendG = svg.select('.legend-g');
    legendG.selectAll('*').remove();
    const legend = legendG.attr('transform', `translate(${width - 150}, ${margin.top})`);

    Object.entries(CLUSTER_COLORS).forEach(([id, color], i) => {
        const row = legend.append('g').attr('transform', `translate(0, ${i * 20})`);
        row.append('circle').attr('r', 5).attr('fill', color);
        row.append('text')
            .attr('x', 12).attr('y', 4)
            .attr('fill', 'var(--text-secondary)')
            .attr('font-size', '10px')
            .text(CLUSTER_NAMES[id]);
    });
}

function renderBarChart() {
    const svg = d3.select('#bar-viz-svg');
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    const margin = {top: 40, right: 30, bottom: 30, left: 100};

    const chartG = svg.select('.chart-g');
    const xAxisG = svg.select('.x-axis');
    const yAxisG = svg.select('.y-axis');
    const title = svg.select('.chart-title');
    const placeholder = svg.select('.placeholder');

    if (!selectedCountry) {
        chartG.selectAll('.bar').transition().duration(300).attr('width', 0).remove();
        chartG.selectAll('.bar-label').transition().duration(300).style('opacity', 0).remove();
        xAxisG.style('opacity', 0);
        yAxisG.style('opacity', 0);
        title.style('opacity', 0);
        placeholder
            .attr('x', width/2).attr('y', height/2)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-secondary)')
            .text('Select a country on the map or scatter plot')
            .transition().duration(500).style('opacity', 1);
        return;
    }

    placeholder.transition().duration(300).style('opacity', 0);
    xAxisG.transition().duration(500).style('opacity', 1);
    yAxisG.transition().duration(500).style('opacity', 1);
    title.transition().duration(500).style('opacity', 1);

    const data = [
        {sector: 'Agriculture', value: selectedCountry.delta_agri},
        {sector: 'Manufacturing', value: selectedCountry.delta_manu},
        {sector: 'Services', value: selectedCountry.delta_services}
    ];

    const x = d3.scaleLinear()
        .domain([d3.min(allData, d => Math.min(d.delta_agri, d.delta_manu, d.delta_services)), 
                 d3.max(allData, d => Math.max(d.delta_agri, d.delta_manu, d.delta_services))])
        .range([margin.left, width - margin.right]);

    const y = d3.scaleBand()
        .domain(data.map(d => d.sector))
        .range([margin.top, height - margin.bottom])
        .padding(0.3);

    xAxisG
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .transition().duration(500)
        .call(d3.axisBottom(x).ticks(5))
        .attr('class', 'x-axis axis-label');

    yAxisG
        .attr('transform', `translate(${margin.left},0)`)
        .transition().duration(500)
        .call(d3.axisLeft(y))
        .attr('class', 'y-axis axis-label');

    chartG.selectAll('.bar')
        .data(data, d => d.sector)
        .join(
            enter => enter.append('rect')
                .attr('class', 'bar')
                .attr('y', d => y(d.sector))
                .attr('x', x(0))
                .attr('width', 0)
                .attr('height', y.bandwidth())
                .attr('rx', 4),
            update => update,
            exit => exit.transition().duration(300).attr('width', 0).remove()
        )
        .transition().duration(500)
        .attr('y', d => y(d.sector))
        .attr('x', d => x(Math.min(0, d.value)))
        .attr('width', d => Math.abs(x(d.value) - x(0)))
        .attr('height', y.bandwidth())
        .attr('fill', d => d.value >= 0 ? 'var(--accent)' : '#ef4444');
        
    chartG.selectAll('.bar-label')
        .data(data, d => d.sector)
        .join(
            enter => enter.append('text')
                .attr('class', 'bar-label')
                .attr('y', d => y(d.sector) + y.bandwidth()/2 + 4)
                .attr('x', x(0))
                .style('opacity', 0)
                .attr('fill', 'white')
                .attr('font-size', '10px'),
            update => update,
            exit => exit.transition().duration(300).style('opacity', 0).remove()
        )
        .transition().duration(500)
        .attr('y', d => y(d.sector) + y.bandwidth()/2 + 4)
        .attr('x', d => x(d.value) + (d.value >= 0 ? 5 : -5))
        .attr('text-anchor', d => d.value >= 0 ? 'start' : 'end')
        .style('opacity', 1)
        .text(d => d.value.toFixed(1) + '%');

    title
        .attr('x', margin.left).attr('y', 25)
        .attr('fill', 'var(--text-primary)')
        .attr('font-weight', 'bold')
        .text(`${selectedCountry.name} Sector Shifts`);
}

function renderHistory() {
    const svg = d3.select('#history-viz-svg');
    const width = +svg.attr('width');
    const height = +svg.attr('height');
    const margin = {top: 20, right: 30, bottom: 30, left: 50};

    const chartG = svg.select('.chart-g');
    const xAxisG = svg.select('.x-axis');
    const yAxisG = svg.select('.y-axis');
    const placeholder = svg.select('.placeholder');

    if (!selectedCountry) {
        chartG.selectAll('*').transition().duration(300).style('opacity', 0).remove();
        xAxisG.style('opacity', 0);
        yAxisG.style('opacity', 0);
        placeholder
            .attr('x', width/2).attr('y', height/2)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-secondary)')
            .text('Select a country to view GDP trajectory')
            .transition().duration(500).style('opacity', 1);
        return;
    }

    placeholder.transition().duration(300).style('opacity', 0);
    xAxisG.transition().duration(500).style('opacity', 1);
    yAxisG.transition().duration(500).style('opacity', 1);

    const data = selectedCountry.history;

    const x = d3.scaleLinear()
        .domain(d3.extent(data, d => d.year))
        .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.gdp) * 1.1])
        .range([height - margin.bottom, margin.top]);

    xAxisG
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .transition().duration(500)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("d")))
        .attr('class', 'x-axis axis-label');

    yAxisG
        .attr('transform', `translate(${margin.left},0)`)
        .transition().duration(500)
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".2s")))
        .attr('class', 'y-axis axis-label');

    const line = d3.line()
        .x(d => x(d.year))
        .y(d => y(d.gdp))
        .curve(d3.curveMonotoneX);

    const area = d3.area()
        .x(d => x(d.year))
        .y0(height - margin.bottom)
        .y1(d => y(d.gdp))
        .curve(d3.curveMonotoneX);

    // Join Line
    const pathLine = chartG.selectAll('.history-line').data([data]);
    pathLine.join(
            enter => enter.append('path').attr('class', 'history-line'),
            update => update,
            exit => exit.remove()
        )
        .attr('fill', 'none')
        .attr('stroke', 'var(--accent)')
        .attr('stroke-width', 3)
        .transition().duration(800)
        .attr('d', line)
        .style('opacity', 1);

    // Join Area
    const pathArea = chartG.selectAll('.history-area').data([data]);
    pathArea.join(
            enter => enter.append('path').attr('class', 'history-area'),
            update => update,
            exit => exit.remove()
        )
        .attr('fill', 'url(#gradient-h)')
        .transition().duration(800)
        .attr('d', area)
        .style('opacity', 0.3);

    // Gradient (re-append if needed)
    if (svg.select('#gradient-h').empty()) {
        const defs = svg.append('defs');
        const gradient = defs.append('linearGradient')
            .attr('id', 'gradient-h')
            .attr('x1', '0%').attr('y1', '0%')
            .attr('x2', '0%').attr('y2', '100%');
        gradient.append('stop').attr('offset', '0%').attr('stop-color', 'var(--accent)');
        gradient.append('stop').attr('offset', '100%').attr('stop-color', 'transparent');
    }
}

// --- HELPERS ---

function showTooltip(event, content) {
    const tooltip = document.getElementById('tooltip');
    tooltip.innerHTML = content;
    tooltip.classList.remove('hidden');
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY + 10) + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').classList.add('hidden');
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

const NAME_MAPPING = {
    'United States of America': 'USA',
    'Democratic Republic of the Congo': 'DR Congo',
    'Republic of the Congo': 'Congo',
    'United Republic of Tanzania': 'Tanzania',
    'Lao PDR': 'Lao People\'s DR',
    'Viet Nam': 'Vietnam'
};

function getNormalizedName(name) {
    return NAME_MAPPING[name] || name;
}
