const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const health = require('homeautomation-js-lib/health.js')
const got = require('got')

module.exports.updateThermostatSetting = function(thermostat_host, setting, inValue) {
    logging.info('Updating ' + setting + ' to: ' + inValue)

    var supportedSetting = false

    switch (setting) {
        case 'tempunits':
        case 'away':
        case 'schedule':
        case 'hum_setpoint':
        case 'dehum_setpoint':
            supportedSetting = true
            break
    }

    if (supportedSetting == false) {
        logging.error('Unsupported setting, ignoring: ' + setting)
        return
    }

    var postValue = inValue
    switch (inValue.toString()) {
        case 'off':
        case 'home':
        case 'fahrenheit':
        case 'f':
            postValue = 0
            break

        case 'away':
        case 'celsius':
        case 'on':
        case 'c':
            postValue = 1
            break
    }
    var formValue = {}

    formValue[setting] = postValue

    logging.info(' => Updating ' + setting + ' to (API value): ' + postValue)
    logging.debug('updating with value: ' + JSON.stringify(formValue))

    got.post({
        url: 'http://' + thermostat_host + '/settings',
        form: formValue
    }, function(error, response, bodyString) {
        const body = !_.isNil(bodyString) ? JSON.parse(bodyString) : {}
        if (_.isNil(error) && response.statusCode == 200 && !_.isNil(body) && _.isNil(body.error)) {
            logging.info(' settings update succeeded: ' + bodyString)
        } else {
            logging.error(' settings update request failed, will retry')
            logging.error(error)
            logging.error(JSON.stringify(response))
            logging.error(bodyString)
            health.unhealthyEvent()
        }
    })
}