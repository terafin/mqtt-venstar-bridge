# mqtt-venstar-bridge

This is a simple docker container that I use to bridge to/from my MQTT bridge.

I have a collection of bridges, and the general format of these begins with these environment variables:

```mqtt
      TOPIC_PREFIX: /your_topic_prefix  (eg: /some_topic_prefix/somthing)
      MQTT_HOST: YOUR_MQTT_URL (eg: mqtt://mqtt.yourdomain.net)
      (OPTIONAL) MQTT_USER: YOUR_MQTT_USERNAME
      (OPTIONAL) MQTT_PASS: YOUR_MQTT_PASSWORD
```

For changing states '/set' commands also work, eg:

publish this to change "Bedroom" to OFF mode (you'll notice this works for all the published attributes)

```mqtt
   topic: /venstar/bedroom/mode/set
   value: off
```

publish this to change "Bedroom" to 14/17 heat/cool limits

```mqtt
   topic: /venstar/bedroom/temperature/heat/set
   value: 14
   topic: /venstar/bedroom/temperature/cool/set
   value: 17
```

publish this turn on "Bedroom" fan (supports, auto/off/on)

```mqtt
   topic: /venstar/bedroom/fan/set
   value: on
```

Settings are supported by publishing to:

```mqtt
   topic: /venstar/bedroom/setting/<SETTING_NAME>/set
   value: <SETTING_VALUE>
```

Settings supported are listed on this page: <https://developer.venstar.com/restcalls.html>

You can also query runtimes at any given time by publishing

```mqtt
   topic: /venstar/bedroom/query
   value: runtime
```

results should publish at: `/venstar/bedroom/result/runtime/KEY:VALUE`

Here's an example docker compose:

```mqtt
version: '3.3'
services:
  mqtt-venstar-bridge:
    image: ghcr.io/terafin/mqtt-venstar-bridge:latest
    environment:
      LOGGING_NAME: mqtt-venstar-bridge
      TZ: America/Los_Angeles
      TOPIC_PREFIX: /your_topic_prefix  (eg: /venstar/living_room)

      VENSTAR_HOST: YOUR_VENSTAR_IP
      (OPTIONAL) VENSTAR_QUERY_INTERVAL: 15 (seconds between queries, 15 is default)

      MQTT_HOST: YOUR_MQTT_URL (eg: mqtt://mqtt.yourdomain.net)
      (OPTIONAL) MQTT_USER: YOUR_MQTT_USERNAME
      (OPTIONAL) MQTT_PASS: YOUR_MQTT_PASSWORD
```

Here's an example publish for my setup:

```mqtt
/environment/thermostat/bedroom/state 0
/environment/thermostat/bedroom/fan 0
/environment/thermostat/bedroom/mode 0
/environment/thermostat/bedroom/temperature/target 16.5
/environment/thermostat/bedroom/name BEDROOM
/environment/thermostat/bedroom/activestage 0
/environment/thermostat/bedroom/fanstate 0
/environment/thermostat/bedroom/tempunits 1
/environment/thermostat/bedroom/schedule 0
/environment/thermostat/bedroom/schedulepart 3
/environment/thermostat/bedroom/away 0
/environment/thermostat/bedroom/spacetemp 18.5
/environment/thermostat/bedroom/heattemp 16
/environment/thermostat/bedroom/cooltemp 17
/environment/thermostat/bedroom/cooltempmin 2
/environment/thermostat/bedroom/cooltempmax 37
/environment/thermostat/bedroom/heattempmin 2
/environment/thermostat/bedroom/heattempmax 37
/environment/thermostat/bedroom/setpointdelta 1
/environment/thermostat/bedroom/availablemodes 0
```
