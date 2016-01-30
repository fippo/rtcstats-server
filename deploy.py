import os
import sys
import time
import logging
import boto.ec2, boto.ec2.elb

if len(sys.argv) == 1:
    conn = boto.ec2.connect_to_region("us-west-2",
           aws_access_key_id='AKIAINB4P5EWARUB4LMA',
           aws_secret_access_key='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')

    reservation = conn.run_instances('ami-f0091d91',
            key_name='skunkworks',
            instance_type='t2.micro',
            security_groups=['launch-wizard-1'])

    instance = reservation.instances[0]

    while instance.update() != "running":
        time.sleep(1)

    ip_address = instance.ip_address
else:
    ip_address = sys.argv[1]

print "Running script for server " + ip_address

from fabric.api import execute, local, run, sudo, env, put
from fabric.network import disconnect_all

def deploy_docker(*args, **kwargs):
    sudo('yum update -y')
    sudo('yum install -y docker')
    sudo('service docker start')
    sudo('usermod -a -G docker ec2-user')

def run_snoop(*args, **kwargs):
    run('docker login -u ggarber -p rebragg -e ggb@tokbox.com')
    run('docker pull tokbox/snoop-server')
    run('docker run -p 3000:3000 -d tokbox/snoop-server')

logging.basicConfig(level=logging.INFO)
env.connection_attempts = 3
env.timeout = 60
env.key_filename='/Users/ggb/.ssh/skunkworks.pem'
execute(deploy_docker, hosts =['ec2-user@' + ip_address])
disconnect_all()
execute(run_snoop, hosts =['ec2-user@' + ip_address])

# ADD TO ELB
elb = boto.ec2.elb.connect_to_region("us-west-2",
       aws_access_key_id='AKIAINB4P5EWARUB4LMA',
       aws_secret_access_key='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')
print elb.get_all_load_balancers()
