/*
 * base-test.js: Test that should be common to all providers.
 *
 * (C) 2013 Nodejitsu Inc.
 *
 */

var fs = require('fs'),
  path = require('path'),
  should = require('should'),
  utile = require('utile'),
  async = require('async'),
  helpers = require('../../helpers'),
  hock = require('hock'),
  async = require('async'),
  _ = require('underscore'),
  providers = require('../../configs/providers.json'),
  versions = require('../../fixtures/versions.json'),
  Flavor = require('../../../lib/pkgcloud/core/compute/flavor').Flavor,
  Image = require('../../../lib/pkgcloud/core/compute/image').Image,
  Server = require('../../../lib/pkgcloud/core/compute/server').Server,
  azureApi = require('../../../lib/pkgcloud/azure/utils/azureApi'),
  mock = !!process.env.MOCK;

var azureOptions = require('../../fixtures/azure/azure-options.json');

azureApi._updateMinimumPollInterval(mock ? 10 : azureApi.MINIMUM_POLL_INTERVAL);

providers.forEach(function(provider) {
  describe('pkgcloud/common/compute/base [' + provider + ']', function () {

    var client = helpers.createClient(provider, 'compute'),
        context = {},
        authServer, server;

    before(function(done) {

      if (!mock) {
        return done();
      }

      async.parallel([
        function(next) {
          hock.createHock({
            port: 12345,
            throwOnUnmatched: false
          }, function(err, hockClient) {
            server = hockClient;
            next();
          });
        },
        function (next) {
          hock.createHock(12346, function (err, hockClient) {
            authServer = hockClient;
            next();
          });
        }
      ], done)
    });

    it('the getVersion() method with no arguments should return the version', function (done) {
      if (mock) {
        setupVersionMock(client, provider, {
          authServer: authServer,
          server: server
        });
      }

      client.getVersion(function (err, version) {
        should.not.exist(err);
        should.exist(version);
        version.should.equal(versions[provider]);

        authServer && authServer.done();
        server && server.done();
        done();
      });

    });

    it('the getFlavors() method should return a list of flavors', function(done) {
      if (mock) {
        setupFlavorMock(client, provider, {
          authServer: authServer,
          server: server
        });
      }

      client.getFlavors(function (err, flavors) {
        should.not.exist(err);
        should.exist(flavors);

        flavors.forEach(function (flavor) {
          flavor.should.be.instanceOf(Flavor);
        });

        context.flavors = flavors;

        authServer && authServer.done();
        server && server.done();

        done();
      });
    });

    it('the getImages() method should return a list of images', function (done) {
      if (mock) {
        setupImagesMock(client, provider, {
          authServer: authServer,
          server: server
        });
      }

      client.getImages(function (err, images) {
        should.not.exist(err);
        should.exist(images);

        images.forEach(function (image) {
          image.should.be.instanceOf(Image);
        });

        context.images = images;

        authServer && authServer.done();
        server && server.done();

        done();
      });
    });

    it('the setWait() method waiting for a server to be operational should return a running server', function (done) {
      var m = mock ? 0.1 : 100;

      if (mock) {
        setupServerMock(client, provider, {
          authServer: authServer,
          server: server
        });
      }

      client.createServer(utile.mixin({
        name: 'create-test-setWait',
        image: context.images[0].id,
        flavor: context.flavors[0].id
      }, provider === 'azure' ? azureOptions : {}), function (err, srv1) {
        should.not.exist(err);
        should.exist(srv1);

        srv1.setWait({ status: 'RUNNING' }, 100 * m, function (err, srv2) {
          should.not.exist(err);
          should.exist(srv2);
          srv2.should.be.instanceOf(Server);
          srv2.name.should.equal('create-test-setWait');
          srv2.status.should.equal('RUNNING');
          context.server = srv2;

          authServer && authServer.done();
          server && server.done();

          done();
        });
      });
    });

    it('the setWait() method waiting for a server to be operational should return a running server', function (done) {
      // TODO enable destroy tests for all providers
      if (provider === 'joyent' || provider === 'amazon' || provider === 'azure') {
        done();
        return;
      }

      if (mock) {
        setupDestroyMock(client, provider, {
          authServer: authServer,
          server: server
        });
      }

      client.destroyServer(context.server, function (err, result) {
        should.not.exist(err);
        should.exist(result);

        authServer && authServer.done();
        server && server.done();

        done();
      });
    });

    after(function(done) {
      if (!mock) {
        return done();
      }

      async.parallel([
        function (next) {
          authServer.close(next);
        },
        function (next) {
          server.close(next);
        }
      ], done)
    });
  });
});

function setupVersionMock(client, provider, servers) {
  if (provider === 'rackspace') {
    servers.server
      .get('/')
      .reply(200,
      { versions: [
        { id: 'v1.0', status: 'BETA'}
      ]});
  }
  else if (provider === 'openstack') {
    servers.authServer
      .post('/v2.0/tokens', {
        auth: {
          passwordCredentials: {
            username: 'MOCK-USERNAME',
            password: 'MOCK-PASSWORD'
          }
        }
      })
      .replyWithFile(200, __dirname + '/../../fixtures/openstack/initialToken.json')
      .get('/v2.0/tenants')
      .replyWithFile(200, __dirname + '/../../fixtures/openstack/tenantId.json')
      .post('/v2.0/tokens', {
        auth: {
          passwordCredentials: {
            username: 'MOCK-USERNAME',
            password: 'MOCK-PASSWORD'
          },
          tenantId: '72e90ecb69c44d0296072ea39e537041'
        }
      })
      .replyWithFile(200, __dirname + '/../../fixtures/openstack/realToken.json');

    servers.server
      .get('/v2/')
      .replyWithFile(200, __dirname + '/../../fixtures/openstack/versions.json');
  }
  else if (provider === 'joyent') {
    servers.server
      .get('/' + client.account + '/datacenters')
      .reply(200, '', { 'x-api-version': '6.5.0' });
  }
}

function setupFlavorMock(client, provider, servers) {
  if (provider === 'rackspace') {
    servers.authServer
      .get('/v1.0')
      .reply(204, '', require(__dirname + '/../../fixtures/rackspace/auth.json'));

    servers.server
      .get('/v1.0/537645/flavors/detail.json')
      .replyWithFile(200, __dirname + '/../../fixtures/rackspace/serverFlavors.json');
  }
  else if (provider === 'openstack') {
    servers.server
      .get('/v2/72e90ecb69c44d0296072ea39e537041/flavors/detail')
      .replyWithFile(200, __dirname + '/../../fixtures/openstack/flavors.json');
  }
  else if (provider === 'joyent') {
    servers.server
      .get('/' + client.account + '/packages')
      .replyWithFile(200, __dirname + '/../../fixtures/joyent/flavors.json');
  }
}

function setupImagesMock(client, provider, servers) {
  if (provider === 'rackspace') {
    servers.server
      .get('/v1.0/537645/images/detail.json')
      .replyWithFile(200, __dirname + '/../../fixtures/rackspace/images.json');
  }
  else if (provider === 'openstack') {
    servers.server
      .get('/v2/72e90ecb69c44d0296072ea39e537041/images/detail')
      .replyWithFile(200, __dirname + '/../../fixtures/openstack/images.json');
  }
  else if (provider === 'joyent') {
    servers.server
      .get('/' + client.account + '/datasets')
      .replyWithFile(200, __dirname + '/../../fixtures/joyent/images.json');
  }
  else if (provider === 'amazon') {
    servers.server
      .filteringRequestBody(helpers.authFilter)
      .post('/?Action=DescribeImages', { 'Owner.0': 'self' })
      .replyWithFile(200, __dirname + '/../../fixtures/amazon/images.xml');
  }
  else if (provider === 'azure') {
    servers.server
      .get('/azure-account-subscription-id/services/images')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/images.xml');
  }
}

function setupServerMock(client, provider, servers) {
  if (provider === 'rackspace') {
    servers.server
      .post('/v1.0/537645/servers',
        helpers.loadFixture('rackspace/setWait.json'))
      .replyWithFile(202, __dirname + '/../../fixtures/rackspace/setWaitResp2.json')
      .get('/v1.0/537645/servers/20602046')
      .replyWithFile(200, __dirname + '/../../fixtures/rackspace/20602046.json');
  }
  else if (provider === 'openstack') {
    servers.server
      .post('/v2/72e90ecb69c44d0296072ea39e537041/servers', {
        server: {
          name: 'create-test-setWait',
          flavorRef: 1,
          imageRef: '506d077e-66bf-44ff-907a-588c5c79fa66',
          personality: [],
          key_name: null
        }
      })
      .replyWithFile(202, __dirname + '/../../fixtures/openstack/creatingServer.json')
      .get('/v2/72e90ecb69c44d0296072ea39e537041/servers/5a023de8-957b-4822-ad84-8c7a9ef83c07')
      .replyWithFile(200, __dirname + '/../../fixtures/openstack/serverCreated.json');
  }
  else if (provider === 'joyent') {
    servers.server
      .post('/' + client.account + '/machines',
      { name: 'create-test-setWait',
        'package': 'Small 1GB',
        dataset: 'sdc:sdc:nodejitsu:1.0.0'
      })
      .replyWithFile(200, __dirname + '/../../fixtures/joyent/setWait.json')
      .get('/' + client.account +
        '/machines/534aa63a-104f-4d6d-a3b1-c0d341a20a53')
      .replyWithFile(200, __dirname + '/../../fixtures/joyent/setWaitResp1.json');
  }
  else if (provider === 'amazon') {
    servers.server
      .filteringRequestBody(helpers.authFilter)
      .post('/?Action=RunInstances', {
        'ImageId': 'ami-85db1cec',
        'InstanceType': 'm1.small',
        'MaxCount': '1',
        'MinCount': '1',
        'UserData': 'eyJuYW1lIjoiY3JlYXRlLXRlc3Qtc2V0V2FpdCJ9'
      })
      .replyWithFile(200, __dirname + '/../../fixtures/amazon/run-instances.xml')
      .post('/?Action=DescribeInstances', {
        'Filter.1.Name': 'instance-state-code',
        'Filter.1.Value.1': '0',
        'Filter.1.Value.2': '16',
        'Filter.1.Value.3': '32',
        'Filter.1.Value.4': '64',
        'Filter.1.Value.5': '80',
        'InstanceId.1': 'i-1d48637b'
      })
      .replyWithFile(200, __dirname + '/../../fixtures/amazon/pending-server.xml')
      .post('/?Action=DescribeInstanceAttribute', {
        'Attribute': 'userData',
        'InstanceId': 'i-1d48637b'
      })
      .replyWithFile(200, __dirname + '/../../fixtures/amazon/running-server-attr.xml')
      .post('/?Action=DescribeInstances', {
        'Filter.1.Name': 'instance-state-code',
        'Filter.1.Value.1': '0',
        'Filter.1.Value.2': '16',
        'Filter.1.Value.3': '32',
        'Filter.1.Value.4': '64',
        'Filter.1.Value.5': '80',
        'InstanceId.1': 'i-1d48637b'
      })
      .replyWithFile(200, __dirname + '/../../fixtures/amazon/running-server.xml')
      .post('/?Action=DescribeInstanceAttribute', {
        'Attribute': 'userData',
        'InstanceId': 'i-1d48637b'
      })
      .replyWithFile(200, __dirname + '/../../fixtures/amazon/running-server-attr.xml');

  }
  else if (provider === 'azure') {
    servers.server
      .get('/azure-account-subscription-id/services/hostedservices/create-test-setWait?embed-detail=true')
      .replyWithFile(404, __dirname + '/../../fixtures/azure/hosted-service-404.xml')
      .post('/azure-account-subscription-id/services/hostedservices', helpers.loadFixture('azure/create-hosted-service.xml'))
      .reply(201, '', {
        location: 'https://management.core.windows.net/subscriptions/azure-account-subscription-id/compute/create-test-setWait',
        'x-ms-request-id': 'b67cc525ecc546618fd6fb3e57d724f5'})
      .get('/azure-account-subscription-id/operations/b67cc525ecc546618fd6fb3e57d724f5')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/operation-succeeded.xml')
      .get('/azure-account-subscription-id/services/images/CANONICAL__Canonical-Ubuntu-12-04-amd64-server-20120528.1.3-en-us-30GB.vhd')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/image-1.xml')
      .post('/azure-account-subscription-id/services/hostedservices/create-test-setWait/deployments', helpers.loadFixture('azure/create-deployment.xml'))
      .reply(202, '', {'x-ms-request-id': 'b67cc525ecc546618fd6fb3e57d724f5'})
      .get('/azure-account-subscription-id/operations/b67cc525ecc546618fd6fb3e57d724f5')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/operation-inprogress.xml')
      .get('/azure-account-subscription-id/operations/b67cc525ecc546618fd6fb3e57d724f5')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/operation-succeeded.xml')
      // TODO: have to do this twice as setWait() does not check server status before calling server.refresh()?
      .get('/azure-account-subscription-id/services/hostedservices/create-test-setWait?embed-detail=true')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/running-server.xml')
      .get('/azure-account-subscription-id/services/hostedservices/create-test-setWait?embed-detail=true')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/running-server.xml')
      .filteringRequestBodyRegEx(/.*/, '*')
      .post('/azure-account-subscription-id/services/hostedservices/create-test-setWait/certificates', '*')
      .reply(202, '', {'x-ms-request-id': 'b67cc525ecc546618fd6fb3e57d724f5'})
      .get('/azure-account-subscription-id/operations/b67cc525ecc546618fd6fb3e57d724f5')
      .replyWithFile(200, __dirname + '/../../fixtures/azure/operation-succeeded.xml');
  }
}

function setupDestroyMock(client, provider, servers) {
  if (provider === 'rackspace') {
    servers.server
      .delete('/v1.0/537645/servers/20602046')
      .reply(204);
  }
  else if (provider === 'openstack') {
    servers.server
      .delete('/v2/72e90ecb69c44d0296072ea39e537041/servers/5a023de8-957b-4822-ad84-8c7a9ef83c07')
      .reply(204);
  }
}
