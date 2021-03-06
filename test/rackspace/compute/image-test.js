/*
* image-test.js: Tests for pkgcloud Rackspace compute image requests
*
* (C) 2010-2012 Nodejitsu Inc.
* MIT LICENSE
*
*/

var fs = require('fs'),
    path = require('path'),
    should = require('should'),
    async = require('async'),
    hock = require('hock'),
    helpers = require('../../helpers'),
    mock = !!process.env.MOCK;

describe('pkgcloud/rackspace/compute/images', function () {
  var client,
      testContext = {}, authServer, server;

  before(function (done) {
    client = helpers.createClient('rackspace', 'compute');

    if (!mock) {
      return done();
    }

    async.parallel([
      function (next) {
        hock.createHock(12346, function (err, hockClient) {
          should.not.exist(err);
          should.exist(hockClient);

          authServer = hockClient;
          next();
        });
      },
      function (next) {
        hock.createHock(12345, function (err, hockClient) {
          should.not.exist(err);
          should.exist(hockClient);

          server = hockClient;
          next();
        });
      }
    ], done);
  });

  describe('The pkgcloud Rackspace Compute client', function () {
    before(function(done) {
      if (mock) {
        authServer
          .get('/v1.0')
          .reply(204, '', JSON.parse(helpers.loadFixture('rackspace/auth.json')));

        server
          .get('/v1.0/537645/servers/detail.json')
          .reply(200, helpers.loadFixture('rackspace/servers.json'));
      }

      client.getServers(function(err, servers) {
        should.not.exist(err);
        should.exist(servers);
        servers.should.be.instanceOf(Array);
        testContext.servers = servers;
        authServer && authServer.done();
        server && server.done();
        done();
      });
    });

    it('the createImage() method with a serverId should create a new image', function(done) {
      if (mock) {
        server
          .post('/v1.0/537645/images', { image: { name: 'test-img-id', serverId: 20578901 } })
          .reply(202, helpers.loadFixture('rackspace/queued_image.json'), {});
      }

      client.createImage({ name: 'test-img-id',
        server: testContext.servers[0].id
      }, function(err, image) {
        should.not.exist(err);
        should.exist(image);
        testContext.image = image;
        server && server.done();
        done();
      });
    });
    
    after(function(done) {

      if (mock) {
        server
          .delete('/v1.0/537645/images/18753753')
          .reply(204, '', {});
      }

      client.destroyImage(testContext.image, function(err) {
        should.not.exist(err);
        server && server.done();
        done();
      });
    });
  });

  after(function (done) {
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