const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const repeat = require('repeat')
const health = require('homeautomation-js-lib/health.js')
const request = require('request')

const queryInterval = 15

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

if (_.isNil(shouldRetain)) {
	mqttOptions['retain'] = shouldRetain
}


var connectedEvent = function() {
	health.healthyEvent()

	const topics = [topic_prefix + '/fan/set', 
		topic_prefix + '/mode/set', 
		topic_prefix + '/temperature/cool/set',
		topic_prefix + '/temperature/heat/set']
        
	logging.info('Connected, subscribing ')
	topics.forEach(function(topic) {
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
	logging.info(' ' + topic + ':' + message, {topic: topic, value: message})
	var target = '' + message
	if (topic.indexOf('/mode/set') >= 0) {
		logging.info('MQTT Set Mode: ' + target, {action: 'setmode', value: target})
		updateThermostat(target, 'none', 0, 0)
	} else if (topic.indexOf('/fan/set') >= 0) {
		logging.info('MQTT Set Fan Mode: ' + target, {action: 'setfanmode', result: target})
		updateThermostat('none', target, 0, 0)
	} else if (topic.indexOf('/temperature/heat/set') >= 0) {
		logging.info('MQTT Set Heat Temperature: ' + target, {action: 'setheat', result: target})
		updateThermostat('none', 'none', 0, target)
	} else if (topic.indexOf('/temperature/cool/set') >= 0) {
		logging.info('MQTT Set Cool Temperature: ' + target, {action: 'setcool', result: target})
		updateThermostat('none', 'none', target, 0)
	} 
})

const queryStatus = function(host, callback) {
	request('http://' + host + '/query/info', function(error, response, body) {
		if (_.isNil(error) && response.statusCode == 200) {
			health.healthyEvent()

			var stat = JSON.parse(body)
            
			logging.info(stat)
            
			if (_.isNil(currentHVACMode) ) { 
				currentHVACMode = stat.mode
			}
			if (_.isNil(currentFanMode) ) { 
				currentFanMode = stat.fan
			}
			if (_.isNil(currentHeatTemp) ) {
				currentHeatTemp = stat.heattemp
			}
			if (_.isNil(currentCoolTemp) ) { 
				currentCoolTemp = stat.cooltemp
			}
            
			Object.keys(stat).forEach(statistic => {
				client.smartPublish(topic_prefix + '/' + statistic.toString(), stat[statistic].toString())
			})
		}
        
		if ( !_.isNil(callback)) {
			return callback()
		}
	})
}

const updateThermostat = function(hvacMode, fanMode, coolTemp, heatTemp) {
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

const sendThermostatUpdate = function() {
	logging.info('queued timer fired')

	const formValue = {
		mode: currentHVACMode,
		fan: currentFanMode,
		heattemp: currentHeatTemp, 
		cooltemp: currentCoolTemp
	}

	logging.info('updating with value: ' + JSON.stringify(formValue))

	request.post({
		url:'http://' + thermostat_host + '/control', 
		form: formValue
	}, function(e, r, body){
		logging.error(body)
	})    
}

var thermostatTimer = null

const queueThermostatUpdate = function() {
	if ( _.isNil(thermostatTimer)) {
		logging.info('Cancelling queued timer')
		clearTimeout(thermostatTimer)
	}
	logging.info('Starting queued timer')
    
	thermostatTimer = setTimeout( function() {
		sendThermostatUpdate() 
	}, queryInterval * 1000)
}

const check = function() {
	queryStatus(thermostat_host, null)
}


const startHostCheck = function() {
	logging.info('Starting to monitor: ' + thermostat_host)
	repeat(check).every(queryInterval, 's').start.in(1, 'sec')
}

startHostCheck()
