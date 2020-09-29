/**
 *
 * @param {*} series
 * @param {*} options
 */
function graph(series, options) {
    const highcharts = [];

    Object.keys(series).forEach(key => {
        highcharts.push({
            name: key,
            data: series[key]
        });
    });
    console.log('<script>');
    console.log(
        `${'var d = document.createElement(\'div\');\n'
        + 'd.id = \'chart_\' + Date.now();\n'
        + 'document.getElementById(\'container\').appendChild(d);\n'
        + 'var graph = new Highcharts.Chart({\n'
        + '    title: { text: \''}${options.title || ''}'},\n`
        + '    xAxis: { type: \'datetime\' },\n'
        + '    chart: { zoomType: \'x\', renderTo : d.id },\n'

        // "    plotOptions: {series:{stacking:'percent'}},\n" +
        + `    series: ${JSON.stringify(highcharts)}\n`
        + '});');
    console.log('</script>');
}

module.exports = graph;
