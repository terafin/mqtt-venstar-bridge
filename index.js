const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const request = require('request')
const mqtt_helpers = require('homeautomation-js-lib/mqtt_helpers.js')

const queryInterval = 15
const updateTimer = 5

var CronJob = require('cron').CronJob;

var lastKnownState = null
var pendingThermostatUpdate = false
    // {
    //     "name": "Thermostat",        // Thermostat name
    //     "mode": 0,                   // Current thermostat mode
    //                                  // 0: off
    //                                  // 1: heat
    //                                  // 2: cool
    //                                  // 3: auto
    //     "state": 0,                  // Current thermostat state
    //                                  // 0: idle
    //                                  // 1: heating
    //                                  // 2: cooling
    //                                  // 3: lockout
    //                                  // 4: error
    //     "fan": 0,                    // Current fan setting
    //                                  // 0: auto
    //                                  // 1: on
    //     "fanstate": 0,               // Current fan state
    //                                  // 0: off
    //                                  // 1: on
    //     "tempunits": 0,              // Current temperature units
    //                                  // 0: fahrenheit
    //                                  // 1: celsius
    //     "schedule": 0,               // Current schedule state
    //                                  // 0: off
    //                                  // 1: on
    //     "schedulepart": 0,           // Current schedule part
    //                                  // 0: occupied1 or morning
    //                                  // 1: occupied2 or day
    //                                  // 2: occupied3 or evening
    //                                  // 3: unoccupied or night
    //                                  // 255: inactive
    //     "away": 0,                   // Current away state (residential only)
    //                                  // 0: home
    //                                  // 1: away
    //     "holiday": 0,                // Current holiday state (commercial only)
    //                                  // 0: not observing holiday
    //                                  // 1: observing holiday
    //     "override": 0,               // Current override state (commercial only)
    //                                  // 0: off
    //                                  // 1: on
    //     "overridetime": 0,           // Time left in override (commercial only)
    //                                  // 0 to 240 minutes
    //     "forceunocc": 0,             // Current forceunocc state (commercial only)
    //                                  // 0: off
    //                                  // 1: on
    //     "spacetemp": 73.0,           // Current space temperature
    //     "heattemp": 70.0,            // Current heat to temperature
    //     "cooltemp": 75.0,            // Current cool to temperature
    //     "cooltempmin": 65.0,         // Minimum cool to temperature
    //     "cooltempmax": 99.0,         // Maximum cool to temperature
    //     "heattempmin": 35.0,         // Minimum heat to temperature
    //     "heattempmax": 80.0,         // Maximum heat to temperature
    //     "setpointdelta": 2.0,        // Minimum temperature difference of heat and cool temperatures
    //     "hum": 10,                   // Current humidity, if available
    //     "availablemodes": 0          // Available thermostat modes
    //                                  // 0: all modes
    //                                  // 1: heat only
    //                                  // 2: cool only
    //                                  // 3: heat/cool only
    // }

// Config
var topic_prefix = process.env.TOPIC_PREFIX
var thermostat_host = process.env.VENSTAR_HOST

if (_.isNil(topic_prefix)) {
    logging.warn('TOPIC_PREFIX not set, not starting')
    process.abort()
}

var mqttOptions = { qos: 1 }

var shouldRetain = process.env.MQTT_RETAIN

if (_.isNil(shouldRetain)) {
    shouldRetain = true
}

mqttOptions['retain'] = shouldRetain

var connectedEvent = function() {
    health.healthyEvent()

    const topics = [topic_prefix + '/fan/set',
        topic_prefix + '/mode/set',
        topic_prefix + '/temperature/target/set',
        topic_prefix + '/temperature/cool/set',
        topic_prefix + '/temperature/heat/set'
    ]

    logging.info('Connected, subscribing ')
    topics.forEach(function(topic) {
        logging.info(' => Subscribing to: ' + topic)
        client.subscribe(topic, { qos: 1 })
    }, this)
}

var disconnectedEvent = function() {
    health.unhealthyEvent()
}

// Setup MQTT
const client = mqtt_helpers.setupClient(connectedEvent, disconnectedEvent)

var currentHVACMode = null
var currentFanMode = null
var currentHeatTemp = null
var currentCoolTemp = null

var updateFanMode = null

client.on('message', (topic, message) => {
    logging.info(' ' + topic + ':' + message, {
        topic: topic,
        value: message
    })
    var target = '' + message
    if (topic.indexOf('/mode/set') >= 0) {
        logging.info('MQTT Set Mode: ' + target, {
            action: 'setmode',
            value: target
        })
        updateThermostat(target, 'none', 0, 0, 0)
    } else if (topic.indexOf('/fan/set') >= 0) {
        logging.info('MQTT Set Fan Mode: ' + target, {
            action: 'setfanmode',
            result: target
        })
        updateThermostat('none', target, 0, 0, 0)
    } else if (topic.indexOf('/temperature/heat/set') >= 0) {
        logging.info('MQTT Set Heat Temperature: ' + target, {
            action: 'setheat',
            result: target
        })
        updateThermostat('none', 'none', 0, target, 0)
    } else if (topic.indexOf('/temperature/cool/set') >= 0) {
        logging.info('MQTT Set Cool Temperature: ' + target, {
            action: 'setcool',
            result: target
        })
        updateThermostat('none', 'none', target, 0, 0)
    } else if (topic.indexOf('/temperature/target/set') >= 0) {
        logging.info('MQTT Set Target Temperature: ' + target, {
            action: 'settarget',
            result: target
        })
        updateThermostat('none', 'none', 0, 0, target)
    }
})


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
            Object.keys(runtime).forEach(key => {
                const value = runtime[key]
                if (!_.isNil(value)) {
                    client.smartPublish(mqtt_helpers.generateTopic(topic_prefix, 'runtime', key.toString()), value.toString(), mqttOptions)
                }
            });


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
                logging.debug('sensor: ' + JSON.stringify(sensor))
                if (!_.isNil(sensor.temp)) {
                    client.smartPublish(mqtt_helpers.generateTopic(topic_prefix, 'sensor', sensor.name.toString(), 'temp'), sensor.temp.toString(), mqttOptions)
                }
                if (!_.isNil(sensor.hum)) {
                    client.smartPublish(mqtt_helpers.generateTopic(topic_prefix, 'sensor', sensor.name.toString(), 'humidity'), sensor.hum.toString(), mqttOptions)
                }
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

                client.smartPublish(topic_prefix + '/' + statistic.toString(), stat[statistic].toString(), mqttOptions)
            })

            if (!_.isNil(currentHeatTemp) && !_.isNil(currentCoolTemp)) {
                client.smartPublish(topic_prefix + '/temperature/target', Number((currentHeatTemp + currentCoolTemp) / 2).toString(), mqttOptions)
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

const updateThermostat = function(hvacMode, fanMode, coolTemp, heatTemp, targetTemp) {
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
}, null, true);

queryJob.start()

// Set up the runtime query on the hour
const runtimeExpression = '0 * * * *'
var runtimeQueryJob = new CronJob(queryExpression, function() {
    queryRuntimes(thermostat_host)
}, null, true);

runtimeQueryJob.start()

// May as well hit it once now :)
queryRuntimes(thermostat_host)