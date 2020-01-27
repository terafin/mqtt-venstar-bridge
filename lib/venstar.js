const EventEmitter = require('events')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const request = require('request')
const actions = require('./actions.js')
var CronJob = require('cron').CronJob;

const thermostat_host = process.env.VENSTAR_HOST
const queryInterval = 15
const updateTimer = 5

var lastKnownState = null
var pendingThermostatUpdate = false


if (_.isNil(thermostat_host)) {
    logging.warn('VENSTAR_HOST not set, not starting')
    process.abort()
}

var currentHVACMode = null
var currentFanMode = null
var currentHeatTemp = null
var currentCoolTemp = null

var updateFanMode = null

module.exports = new EventEmitter()

module.exports.updateThermostatSetting = function(setting, inValue) {
    actions.updateThermostatSetting(thermostat_host, setting, inValue)
}
const queryAlerts = function(host) {
    request('http://' + host + '/query/alerts', function(error, response, body) {
        if (_.isNil(error) && response.statusCode == 200) {
            health.healthyEvent()

            var alerts = JSON.parse(body)

            logging.debug(body)

            if (_.isNil(alerts) || _.isNil(alerts.alerts)) {
                return
            }

            alerts.alerts.forEach(alert => {
                module.exports.emit('alert-updated', alert)
            });

        } else {
            health.unhealthyEvent()
            logging.error('query alerts failed: ' + error)
            logging.error('        body: ' + body)
        }
    })
}



const queryRuntimes = function(host) {
    request('http://' + host + '/query/runtimes', function(error, response, body) {
        if (_.isNil(error) && response.statusCode == 200) {
            health.healthyEvent()

            var runtimes = JSON.parse(body)

            logging.debug(body)

            if (_.isNil(runtimes) || _.isNil(runtimes.runtimes)) {
                return
            }

            const runtime = _.last(runtimes.runtimes)
            logging.debug('runtime: ' + JSON.stringify(runtime))
            module.exports.emit('runtime-updated', runtime)
        } else {
            health.unhealthyEvent()
            logging.error('query runtime failed: ' + error)
            logging.error('        body: ' + body)
        }
    })
}


const querySensors = function(host) {
    request('http://' + host + '/query/sensors', function(error, response, body) {
        if (_.isNil(error) && response.statusCode == 200) {
            health.healthyEvent()

            var sensors = JSON.parse(body)

            logging.debug(body)

            if (_.isNil(sensors) || _.isNil(sensors.sensors)) {
                return
            }

            sensors.sensors.forEach(sensor => {
                module.exports.emit('sensor-updated', sensor)
            });


        } else {
            health.unhealthyEvent()
            logging.error('query status failed: ' + error)
            logging.error('        body: ' + body)
        }
    })
}


const queryInfo = function(host) {
    request('http://' + host + '/query/info', function(error, response, body) {
        if (_.isNil(error) && response.statusCode == 200) {
            health.healthyEvent()

            var stat = JSON.parse(body)

            if (!_.isNil(stat)) {
                lastKnownState = stat
            }

            logging.debug(body)

            if (!pendingThermostatUpdate) {
                if (!_.isNil(stat.mode)) {
                    currentHVACMode = stat.mode
                }
                if (!_.isNil(stat.fan)) {
                    currentFanMode = stat.fan
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
        } else {
            health.unhealthyEvent()
            logging.error('query failed: ' + error)
            logging.error('        body: ' + body)
        }
    })
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

    queueThermostatUpdate()
}

const sendThermostatUpdate = function() {
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

    request.post({
        url: 'http://' + thermostat_host + '/control',
        form: formValue
    }, function(error, response, bodyString) {
        const body = !_.isNil(bodyString) ? JSON.parse(bodyString) : {}
        if (_.isNil(error) && response.statusCode == 200 && !_.isNil(body) && _.isNil(body.error)) {
            logging.info(' update succeeded: ' + bodyString)
            pendingThermostatUpdate = false
        } else {
            logging.error(' update request failed, will retry')
            logging.error(error)
            logging.error(JSON.stringify(response))
            logging.error(bodyString)
            health.unhealthyEvent()
            queueThermostatUpdate()
        }
    })
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
}, null, true);

queryJob.start()

// Set up the runtime query on the hour
const runtimeExpression = '0 * * * *'
var runtimeQueryJob = new CronJob(runtimeExpression, function() {
    queryRuntimes(thermostat_host)
}, null, true);

runtimeQueryJob.start()

// May as well hit it once now :)
queryRuntimes(thermostat_host)