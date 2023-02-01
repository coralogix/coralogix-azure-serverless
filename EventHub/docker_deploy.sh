#!/bin/bash

#Add required variables for given integration to this string
required_env_vars="EVENTHUB_SAS_POLICY_CONNECTION_STRING AZURE_EVENTHUB_NAME CORALOGIX_PRIVATE_KEY AZURE_REGION"

#Function to validate required variables are set
check_vars()
{
    var_names=("$@")
    for var_name in "${var_names[@]}"; do
      if [ -z "${!var_name}" ]
      then
        echo "Required variable $var_name is unset."
        var_unset=true
      fi
    done
    if [ -n "$var_unset" ]
    then
      echo "Please ensure you use '--env-file env.vars' when running the docker container"
      echo "Exiting"
      exit 1
    fi
    echo "Required variables are set."
    return 0
}

#success function. Exits the script if the command fails.
check_fault () {
    if ! [ $? -eq 0 ]
    then
        exit 1
    fi
}

# check that script is running inside a docker container
if [ -f /.dockerenv ]
then
    check_vars $required_env_vars
    echo "Logging into Azure Account"
    az login
    check_fault
    echo "Setting up environment"
    make clean
    make functools
    check_fault
    export UUID=$(od -vN "7" -An -tx1 /dev/urandom|tr -d " \n"; echo)
    echo "Using $UUID as our uniqness seed for this deployment."
    #If storage queue name is not empty (changed from default of "logs"
    echo "Monitored EventHub: $AZURE_EVENTHUB_NAME"
    sed -i.bak "s/YOUR_EVENTHUB/$AZURE_EVENTHUB_NAME/g" EventHub/function.json
    echo "----- MAKE INSTALL -----"
    make install
    check_fault
    echo "----- MAKE CONFIGURE -----"
    make configure
    check_fault
    echo "----- MAKE PUBLISH -----"
    make publish
    check_fault

else
    echo -n "This deployment script is designed to function with a prebuilt docker container.\nYou can find its repo here: https://github.com/MichaelBriggs-Coralogix/coralogix-azure-deploy";
    exit 1
fi
