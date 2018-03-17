const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const c2f = require('celsius-to-fahrenheit')
const f2c = require('fahrenheit-to-celsius')
const repeat = require('repeat')
const bodyParser = require('body-parser')
const health = require('homeautomation-js-lib/health.js')
const request = require('request')
var parseString = require('xml2js').parseString

require('homeautomation-js-lib/mqtt_helpers.js')

// Config
var topic_prefix = process.env.TOPIC_PREFIX
var thermostat_host = process.env.VENSTAR_HOST

if (_.isNil(topic_prefix)) {
    logging.warn('TOPIC_PREFIX not set, not starting')
    process.abort()
}

var mqttOptions = {}

var shouldRetain = process.env.MQTT_RETAIN

if (_.isNil(shouldRetain)) {
    shouldRetain = false
}

if (!_.isNil(shouldRetain)) {
    mqttOptions['retain'] = shouldRetain
}


var connectedEvent = function() {
    health.healthyEvent()

    const topics = [topic_prefix + '/fan/set', 
        topic_prefix + '/mode/set', 
        topic_prefix + '/temperature/cool/set',
        topic_prefix + '/temperature/heat/set'
    ]
    logging.info('Connected, subscribing ')
    topics.forEach(function (topic) {
        logging.info(' => Subscribing to: ' + topic)
        client.subscribe(topic)
    }, this)
}

var disconnectedEvent = function() {
    health.unhealthyEvent()
}

// Setup MQTT
const client = mqtt.setupClient(connectedEvent, disconnectedEvent)

var currentHVACMode = null
var currentFanMode = null
var currentHeatTemp = null
var currentCoolTemp = null

client.on('message', (topic, message) => {
    logging.info(' ' + topic + ':' + message, { topic: topic, value: message })
    var target = '' + message
    if (topic.indexOf('/mode/set') >= 0) {
        logging.info('MQTT Set Mode: ' + target, { action: 'setmode', value: target })
        updateThermostat(target, 'none', 0, 0)
    } else if (topic.indexOf('/fan/set') >= 0) {
        logging.info('MQTT Set Fan Mode: ' + target, { action: 'setfanmode', result: target })
        updateThermostat('none', target, 0, 0)
    } else if (topic.indexOf('/temperature/heat/set') >= 0) {
        logging.info('MQTT Set Heat Temperature: ' + target, { action: 'setheat', result: target })
        updateThermostat('none', 'none', 0, target)
    } else if (topic.indexOf('/temperature/cool/set') >= 0) {
        logging.info('MQTT Set Cool Temperature: ' + target, { action: 'setcool', result: target })
        updateThermostat('none', 'none', target, 0)
    } 
})

function queryStatus(host, callback) {
    request('http://' + host + '/query/info', function (error, response, body) {
        if (!error && response.statusCode == 200) {
            health.healthyEvent()

            var stat = JSON.parse(body)
            logging.info(stat)
            if (_.isNil(currentHVACMode)  currentHVACMode = stat.mode
            if (_.isNil(currentFanMode)  currentFanMode = stat.fan
            if (_.isNil(currentHeatTemp)  currentHeatTemp = stat.heattemp
            if (_.isNil(currentCoolTemp)  currentCoolTemp = stat.cooltemp
            
            Object.keys(stat).forEach(statistic => {
                client.smartPublish(topic_prefix + '/' + statistic.toString(), stat[statistic].toString())
            })
        }
    })
}

function updateThermostat(hvacMode, fanMode, coolTemp, heatTemp) {
    if ( coolTemp > 0 ) {
        coolTemp = Number(coolTemp).toFixed(0)
        currentCoolTemp = coolTemp
    }
    
    if ( heatTemp > 0 ) {
        heatTemp = Number(heatTemp).toFixed(0)
        currentHeatTemp = heatTemp
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
            currentFanMode = 0
            break
        case 'on':
            currentFanMode = 1
            break
    }

    queueThermostatUpdate()
}

function sendThermostatUpdate() {
    const formValue = {
        mode:currentHVACMode,
        fan:currentFanMode,
        heattemp: currentHeatTemp, 
        cooltemp: currentCoolTemp
    }

    logging.info('updating with value: ' + JSON.stringify(formValue))

    request.post({
        url:'http://' + thermostat_host + '/control', 
        form: formValue
      }, function(e,r, body){
        logging.error(body)
      })    
}

var thermostatTimer = null

function queueThermostatUpdate() {
    if ( !_.isNil(thermostatTimer)) {
        clearTimeout(thermostatTimer)
    }
    thermostatTimer = setTimeout( function() { sendThermostatUpdate() } , 15 * 1000)
}

function check() {
    queryStatus(thermostat_host, null)
}


function startHostCheck() {
    logging.info('Starting to monitor: ' + thermostat_host)
    repeat(check).every(30, 's').start.in(1, 'sec')
}

startHostCheck()
