import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';

export class CdkFluentStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const vpc = new ec2.Vpc(this, 'vpc', {
      maxAzs: 2,
    });

    const logbucket = new s3.Bucket(this, 'logbucket');
    const userdata = ec2.UserData.forLinux({
      shebang: '#!/bin/env bash',
    });

    const fluents3 =
      ` <match fluentd.test.**>
        @type s3
        s3_bucket ` +
      logbucket.bucketName +
      ` s3_region us-east-2
        path fluentlog/
      </match>`;
    const userdatacmd = [
      'curl -L https://toolbelt.treasuredata.com/sh/install-amazon2-td-agent4.sh | sh',
      'amazon-linux-extras install ruby3.0',
      'yum install -y ruby-devel gcc',
      'systemctl start td-agent',
      'sudo -u ec2-user -i mkdir rubyapp',
      'sudo gem install bundler',
      'sed -r -e "s|^(Defaults\\s+secure_path.*)|\\1:/usr/local/bin|" -i /etc/sudoers',

      "cat <<'EOF'> Gemfile",
      'source "https://rubygems.org"',
      "gem 'fluent-logger'",
      'EOF',

      //'sudo -u ec2-user -i bash -c "echo \\"source \'https://rubygems.org\'\\">rubyapp/Gemfile"',
      //'sudo -u ec2-user -i bash -c "echo \\"gem \'fluent-logger\', \'~> 0.7.1\'\\">>rubyapp/Gemfile"',

      "cat <<'EOF'> app.rb",
      "require 'fluent-logger'",
      "Fluent::Logger::FluentLogger.open(nil, :host=>'localhost', :port=>24224)",
      'Fluent::Logger.post("fluentd.test.follow", {"from"=>"userA", "to"=>"userB"})',
      'EOF',

      'mv Gemfile ~ec2-user/rubyapp/',
      'mv app.rb ~ec2-user/rubyapp/',
      'chown -R ec2-user. ~ec2-user/rubyapp',
      'sudo -u ec2-user -i bash -c "cd rubyapp; bundle config set --local path "vendor/bundle"; bundle install"',

      "cat <<'EOF'>> /etc/td-agent/td-agent.conf",
      '<match fluentd.test.**>',
      '@type s3',
      's3_bucket eksfluenttestbucket',
      's3_region us-east-2',
      'path fluentlog/',
      '</match>',
      'EOF',
      'systemctl restart td-agent',
    ];
    userdata.addCommands(...userdatacmd);

    const fec2 = new ec2.Instance(this, 'fec2', {
      vpc,
      userData: userdata,
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        storage: ec2.AmazonLinuxStorage.GENERAL_PURPOSE,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.C5,
        ec2.InstanceSize.LARGE,
      ),
    });

    // policy
    const policies: string[] = [
      'AmazonSSMManagedInstanceCore',
      'AmazonS3FullAccess',
      'AmazonKinesisFullAccess',
      //"service-role/AmazonEC2RoleforSSM"
      //'CloudWatchAgentServerPolicy',
    ];

    for (let v of policies) {
      fec2.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName(v));
    }

    new cdk.CfnOutput(this, 'ssm', {
      value: 'aws ssm start-session --target ' + fec2.instanceId,
    });
  }
}
