env.SERVICE_ID1='1s20'
env.SERVICE_ID2='1s143'
env.SERVICE_ID3='1s142'
env.SERVICE_ID4='1s144'
env.SERVICE_ID5='1s145'

node {
   stage('Checkout') {
      git 'https://github.com/terafin/mqtt-venstar-bridge.git'
   }
   stage('Docker Build') {
       sh 'docker build --rm=false -t "$DOCKER_USER/$JOB_NAME" .'
   }
   stage('Push to Docker') {
      sh 'docker login -u "$DOCKER_USER" -p "$DOCKER_PASS"'
      sh 'docker push $DOCKER_USER/$JOB_NAME'
   }
   stage('Deploy to Rancher') {
      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID1/upgrade'
      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID1/finish_upgrade'

      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID2/upgrade'
      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID2/finish_upgrade'

      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID3/upgrade'
      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID3/finish_upgrade'

      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID4/upgrade'
      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID4/finish_upgrade'

      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID5/upgrade'
      sh 'curl --user $AUTH_PARAMETERS http://rancher-webhook/api/services/$SERVICE_ID5/finish_upgrade'
    }
   stage('Notify') {
      sh 'curl -s --form-string "token=$PUSHOVER_APP_TOKEN"  --form-string "user=$PUSHOVER_USER_TOKEN"  --form-string "message=$JOB_NAME deployed to home" https://api.pushover.net/1/messages.json'
    }
}
