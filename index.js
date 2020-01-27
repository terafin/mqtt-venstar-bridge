const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const venstar = require('./lib/venstar.js')
const mqtt_helpers = require('homeautomation-js-lib/mqtt_helpers.js')


var topic_prefix = process.env.TOPIC_PREFIX

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
        topic_prefix + '/setting/+/set',
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
        venstar.updateThermostat(target, 'none', 0, 0, 0)
    } else if (topic.indexOf('/fan/set') >= 0) {
        logging.info('MQTT Set Fan Mode: ' + target, {
            action: 'setfanmode',
            result: target
        })
        venstar.updateThermostat('none', target, 0, 0, 0)
    } else if (topic.indexOf('/temperature/heat/set') >= 0) {
        logging.info('MQTT Set Heat Temperature: ' + target, {
            action: 'setheat',
            result: target
        })
        venstar.updateThermostat('none', 'none', 0, target, 0)
    } else if (topic.indexOf('/temperature/cool/set') >= 0) {
        logging.info('MQTT Set Cool Temperature: ' + target, {
            action: 'setcool',
            result: target
        })
        venstar.updateThermostat('none', 'none', target, 0, 0)
    } else if (topic.indexOf('/temperature/target/set') >= 0) {
        logging.info('MQTT Set Target Temperature: ' + target, {
            action: 'settarget',
            result: target
        })
        venstar.updateThermostat('none', 'none', 0, 0, target)
    } else if (topic.indexOf('/set') >= 0) {
        logging.info('MQTT General Setting: ' + target, {
            action: 'settarget',
            result: target
        })
        const components = topic.split('/')
        const settingName = components[components.length - 2]
        venstar.updateThermostatSetting(settingName, message)
    }
})


venstar.on('alert-updated', (alert) => {
    const value = alert.active == 'true' ? 1 : 0
    client.smartPublish(mqtt_helpers.generateTopic(topic_prefix, 'alert', alert.name.toString()), value.toString(), mqttOptions)
})

venstar.on('runtime-updated', (runtime) => {
    Object.keys(runtime).forEach(key => {
        const value = runtime[key]
        if (!_.isNil(value)) {
            client.smartPublish(mqtt_helpers.generateTopic(topic_prefix, 'runtime', key.toString()), value.toString(), mqttOptions)
        }
    });
})

venstar.on('sensor-updated', (sensor) => {
    logging.debug('sensor: ' + JSON.stringify(sensor))
    if (!_.isNil(sensor.temp)) {
        client.smartPublish(mqtt_helpers.generateTopic(topic_prefix, 'sensor', sensor.name.toString(), 'temp'), sensor.temp.toString(), mqttOptions)
    }
    if (!_.isNil(sensor.hum)) {
        client.smartPublish(mqtt_helpers.generateTopic(topic_prefix, 'sensor', sensor.name.toString(), 'humidity'), sensor.hum.toString(), mqttOptions)
    }
})

venstar.on('statistic-updated', (statistic, value) => {
    client.smartPublish(topic_prefix + '/' + statistic.toString(), value.toString(), mqttOptions)
})

venstar.on('target-temperature-updated', (target) => {
    client.smartPublish(topic_prefix + '/temperature/target', target.toString(), mqttOptions)
})