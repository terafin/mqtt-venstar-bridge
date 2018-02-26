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

function queryStatus(host, callback) {
    request('http://' + host + '/query/info', function (error, response, body) {
        if (!error && response.statusCode == 200) {
            health.healthyEvent()
            
            var stat = JSON.parse(body);
            logging.info(stat);
            currentHVACMode = stat.mode
            currentFanMode = stat.fan
            currentHeatTemp = stat.heattemp
            currentCoolTemp = stat.cooltemp
            
            Object.keys(stat).forEach(statistic => {
                client.smartPublish(topic_prefix + '/' + statistic.toString(), stat[statistic].toString())
            });
        }
    })
}

function updateThermostat(hvacMode, fanMode, coolTemp, heatTemp) {
    var hvacModeNumber = currentHVACMode
    var fanModeNumber = currentFanMode
    var coolTempNumber = currentCoolTemp
    var heatTempNumber = currentHeatTemp

    switch (hvacMode) {
        case 'off':
            hvacModeNumber = 0
            break
        case 'heat':
            hvacModeNumber = 1
            break
        case 'cool':
            hvacModeNumber = 2
            break
        case 'auto':
            hvacModeNumber = 3
            break
    }

    switch (fanMode) {
        case 'auto':
        case 'off':
            fanModeNumber = 0
            break
        case 'on':
            fanModeNumber = 1
            break
    }


    request.post({
        url:'http://' + host + '/control', 
        form:{
            mode:hvacModeNumber,
            fan:fanModeNumber,
            heattemp: heatTempNumber, 
            cooltemp: coolTempNumber
        }
      }, function(e,r, body){
        logging.error(body);
      })
}

function check() {
    queryStatus(thermostat_host, null)
}


function startHostCheck() {
    logging.info('Starting to monitor: ' + thermostat_host)
    repeat(check).every(30, 's').start.in(1, 'sec')
}

startHostCheck()
