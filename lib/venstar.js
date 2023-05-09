const EventEmitter = require('events')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const actions = require('./actions.js')
var CronJob = require('cron').CronJob

const got = require('got')

const thermostat_host = process.env.VENSTAR_HOST
var queryInterval = process.env.VENSTAR_QUERY_INTERVAL
const updateTimer = 5

var lastKnownState = null
var pendingThermostatUpdate = false

if (_.isNil(queryInterval)) {
    queryInterval = 15
}

if (_.isNil(thermostat_host)) {
    logging.warn('VENSTAR_HOST not set, not starting')
    process.abort()
}

var currentHVACMode = null
var currentHeatTemp = null
var currentCoolTemp = null

var updateFanMode = null

module.exports = new EventEmitter()

module.exports.updateThermostatSetting = function(setting, inValue) {
    actions.updateThermostatSetting(thermostat_host, setting, inValue)
}

async function queryAlerts(host) {
    try {
        const response = await got('http://' + host + '/query/alerts')
        const alerts = JSON.parse(response.body)
        logging.debug('alerts: ' + JSON.stringify(alerts))
        health.healthyEvent()

        if (!_.isNil(alerts) && !_.isNil(alerts.alerts)) {
            alerts.alerts.forEach(alert => {
                module.exports.emit('alert-updated', alert)
            })
        }
    } catch (error) {
        logging.error('query alerts failed: ' + error)
        health.unhealthyEvent()
    }
}



async function queryRuntimes(host, isQuery) {
    try {
        const response = await got('http://' + host + '/query/runtimes')
        const runtimes = JSON.parse(response.body)
        logging.debug('runtimes: ' + JSON.stringify(runtimes))
        health.healthyEvent()

        if (!_.isNil(runtimes) && !_.isNil(runtimes.runtimes)) {
            const runtime = _.last(runtimes.runtimes)
            logging.debug('runtime: ' + JSON.stringify(runtime))

            if (isQuery) {
                module.exports.emit('query-response', 'runtime', runtime)
            } else {
                module.exports.emit('runtime-updated', runtime)
            }
        }
    } catch (error) {
        logging.error('query runtime failed: ' + error)
        health.unhealthyEvent()
    }
}


async function querySensors(host) {
    try {
        const response = await got('http://' + host + '/query/sensors')
        const sensors = JSON.parse(response.body)
        logging.debug('sensors: ' + JSON.stringify(sensors))
        health.healthyEvent()

        if (!_.isNil(sensors) && !_.isNil(sensors.sensors)) {
            sensors.sensors.forEach(sensor => {
                module.exports.emit('sensor-updated', sensor)
            })
        }
    } catch (error) {
        logging.error('query status failed: ' + error)
        health.unhealthyEvent()
    }
}


async function queryInfo(host) {
    try {
        const response = await got('http://' + host + '/query/info')
        const stat = JSON.parse(response.body)
        logging.debug('stat: ' + JSON.stringify(stat))
        health.healthyEvent()

        if (!_.isNil(stat)) {
            lastKnownState = stat
        }

        if (!pendingThermostatUpdate) {
            if (!_.isNil(stat.mode)) {
                currentHVACMode = stat.mode
            }
            if (!_.isNil(stat.heattemp)) {
                currentHeatTemp = stat.heattemp
            }
            if (!_.isNil(stat.cooltemp)) {
                currentCoolTemp = stat.cooltemp
            }
        }

        Object.keys(stat).forEach(statistic => {
            module.exports.emit('statistic-updated', statistic, stat[statistic])
        })

        if (!_.isNil(currentHeatTemp) && !_.isNil(currentCoolTemp)) {
            module.exports.emit('target-temperature-updated', Number((currentHeatTemp + currentCoolTemp) / 2))
        }
    } catch (error) {
        logging.error('query info failed: ' + error)
        health.unhealthyEvent()
    }
}

const requiredSetpointDelta = function() {
    var setPointDelta = 2

    if (!_.isNil(lastKnownState) && !_.isNil(lastKnownState.setpointdelta)) {
        setPointDelta = lastKnownState.setpointdelta
    }

    return Number(setPointDelta)
}
const roundToHalf = function(num) {
    return Math.round(num * 2) / 2
}

module.exports.query = function(target) {
    switch (target) {
        case 'runtime':
            queryRuntimes(thermostat_host, true)
            break
        default:
            logging.error('Unsupported query type: ' + target)
            break
    }
}

module.exports.updateThermostat = function(hvacMode, fanMode, coolTemp, heatTemp, targetTemp) {
    var setPointDelta = requiredSetpointDelta()

    if (targetTemp > 0) {
        targetTemp = roundToHalf(targetTemp)

        coolTemp = targetTemp + (setPointDelta / 2)
        heatTemp = targetTemp - (setPointDelta / 2)

        logging.info('Using target: ' + targetTemp + '(delta: ' + setPointDelta + ')  for setpoints: ' + heatTemp + ':' + coolTemp)
    }

    if (coolTemp > 0) {
        coolTemp = Number(roundToHalf(coolTemp)).toFixed(1)
        currentCoolTemp = coolTemp

        if ((currentHeatTemp - currentCoolTemp) < setPointDelta) {
            currentHeatTemp = Number(currentCoolTemp) - Number(setPointDelta)
            logging.info(' * fixing setpoint, adjusting heat setpoint to: ' + currentHeatTemp + '  (required delta: ' + setPointDelta + ')')
        }
    }

    if (heatTemp > 0) {
        heatTemp = Number(roundToHalf(heatTemp)).toFixed(1)
        currentHeatTemp = heatTemp

        if ((currentHeatTemp - currentCoolTemp) < setPointDelta) {
            currentCoolTemp = Number(currentHeatTemp) + Number(setPointDelta)
            logging.info(' * fixing setpoint, adjusting cool setpoint to: ' + currentCoolTemp + '  (required delta: ' + setPointDelta + ')')
        }
    }

    switch (hvacMode) {
        case 'off':
            currentHVACMode = 0
            break
        case 'heat':
            currentHVACMode = 1
            break
        case 'cool':
            currentHVACMode = 2
            break
        case 'auto':
            currentHVACMode = 3
            break
    }

    switch (fanMode) {
        case 'auto':
        case 'off':
            updateFanMode = 0
            break
        case 'on':
            updateFanMode = 1
            break
    }

    // Check to see if the temps make sense, if not, let's fix that
    if (hvacMode == 'auto') {
        if (currentCoolTemp < currentHeatTemp) {
            logging.info('Switching to auto mode, but the temps do not make sense, re-adjusting')
            logging.info('  Current Cool Temp: ' + currentCoolTemp)
            logging.info('  Current Heat Temp: ' + currentHeatTemp)
            currentCoolTemp = currentHeatTemp + setPointDelta
            logging.info('  Adjusted Cool Temp: ' + currentCoolTemp)
        }
    }

    queueThermostatUpdate()
}

async function sendThermostatUpdate() {
    logging.info('queued timer fired')

    var formValue = {
        mode: currentHVACMode,
        heattemp: currentHeatTemp,
        cooltemp: currentCoolTemp
    }

    if (!_.isNil(updateFanMode)) {
        formValue.fan = updateFanMode
        updateFanMode = null
    }
    logging.info('updating with value: ' + JSON.stringify(formValue))

    try {
        const response = await got.post({
            url: 'http://' + thermostat_host + '/control',
            form: formValue
        })
        const body = response.body
        pendingThermostatUpdate = false
        logging.info(' update succeeded: ' + body)

    } catch (error) {
        logging.error(' update request failed, will retry: ' + error)
        health.unhealthyEvent()
        queueThermostatUpdate()
    }
}


var thermostatTimer = null

const queueThermostatUpdate = function() {
    pendingThermostatUpdate = true

    if (_.isNil(thermostatTimer)) {
        logging.info('Cancelling queued timer')
        clearTimeout(thermostatTimer)
    }
    logging.info('Starting queued timer')

    thermostatTimer = setTimeout(function() {
        sendThermostatUpdate()
    }, updateTimer * 1000)
}

// Set up the main poll query, based on queryInterval

const queryExpression = '*/' + queryInterval + ' * * * * *'
var queryJob = new CronJob(queryExpression, function() {
    queryInfo(thermostat_host)
    querySensors(thermostat_host)
    queryAlerts(thermostat_host)
}, null, true)

queryJob.start()

// Set up the runtime query on the hour
const runtimeExpression = '0 * * * *'
var runtimeQueryJob = new CronJob(runtimeExpression, function() {
    queryRuntimes(thermostat_host, false)
}, null, true)

runtimeQueryJob.start()

// May as well hit it once now :)
queryRuntimes(thermostat_host, false)