var fs = require("fs"),
    path = require("path"),
    glob = require("glob"),
    sass = require("node-sass"),
    mkdirp = require("mkdirp"),
    dot = require("dot"),
    imageSize = require('image-size'),
    spritesmith = require("spritesmith");


var currentSprite = null;
var spriteMaps = {};


function getConfig() {
    if (currentSprite === null) {
        throw new Error('There is no config available');
    }
    return currentSprite.config;
}

function getSpriteMapNameFromUri(uri) {
    return path.basename(uri).replace('.png', '');
}


function getCoordinatesForImage(spriteMap, spriteImage) {
    var imageCoordinatesKey = Object.keys(spriteMap.coordinates).filter(
            image => image.indexOf(spriteImage) > -1).pop();
    return spriteMap.coordinates[imageCoordinatesKey];
}

function getImageURL(spriteMap, spriteImage) {
	return Object.keys(spriteMap.coordinates).filter(
            image => image.indexOf(spriteImage) > -1).pop();
}


function createSpriteMap(uri, images, coordinates) {
    var spriteMapName = getSpriteMapNameFromUri(uri);
    var config = getConfig();
    spriteMaps[spriteMapName] = {
        uri: uri,
        name: spriteMapName,
        images: images,
        coordinates: coordinates,
        httpPath: path.join(config.generatedImagesHttpPath, uri),
        absolutePath: path.join(config.generatedImagesPath, uri)
    };
    return spriteMaps[spriteMapName];
}


function updateSpriteMap(name, attributes) {
    spriteMaps[name] = Object.assign(attributes, spriteMaps[name]);
}


function getSpriteMap(uri){
    return spriteMaps[getSpriteMapNameFromUri(uri)] || null;
}


function imageURL(imagePath, onlyPath, cacheBuster){
    var config = getConfig();
    var imagePath = path.join(config.httpImagesPath, imagePath.getValue());
    return new sass.types.String(imagePath);
}


function imageDimensions(img, done){
    var imagePath = img;
    if(!path.isAbsolute(imagePath)){
        imagePath = path.join(currentSprite.config.imagesDir, img);
    }
    imageSize(imagePath, function(err, dimensions){
        if(err){
            done(err);
            return;
        }
        done(null, dimensions);
    });
}


function imageDimensionWrapper(dimension) {
    return function (img, done) {
        imageDimensions(img.getValue(), function (err, dimensions) {
            if (err) {
                done(err);
                return;
            }
            done(new sass.types.Number(dimensions[dimension], 'px'));
        });
    }
}


function spriteDimensionWrapper(dimension) {
	return function(map, sprite, done) {
		var spriteMap = getSpriteMap(map.getValue());
		var spriteImage = sprite.getValue();
		var coordinates = getCoordinatesForImage(spriteMap, spriteImage);
		done(new sass.types.Number(coordinates[dimension], 'px'));
	}
}


function spriteHasSelector(map, sprite, selector, done){
    // TODO (gabriel-laet) Check if image for selector exists
    done(sass.types.Boolean.FALSE);
}


function spriteMap(uri, kwargs, done){
    var argc = kwargs.getLength();
    var properties = [];
    for(var i = 0; i < argc; i++){
        properties.push(kwargs.getValue(i).getValue());
    }

    var spriteMapUri = uri.getValue();
    var spriteMap = getSpriteMap(spriteMapUri);
    updateSpriteMap(spriteMapUri, properties);
    done(new sass.types.String(spriteMapUri));
}


function spriteFile(map, sprite, done){
    var spriteMap = getSpriteMap(map.getValue());
    var spriteImage = sprite.getValue();
    done(new sass.types.String(getImageURL(spriteMap, spriteImage)));
}


function spriteMapName(uri, done){
    var spriteMap = getSpriteMap(uri.getValue());
    done(new sass.types.String(spriteMap.name));
}


function spriteURL(uri, done){
    var spriteMap = getSpriteMap(uri.getValue());
    done(new sass.types.String("url('"+spriteMap.httpPath+"')"));
}


function spritePosition(map, sprite, offsetX, offsetY, done){
    var spriteMapUri = map.getValue();
    var spriteImage = sprite.getValue();
    var spriteMap = getSpriteMap(spriteMapUri);

    if (spriteMap === null) {
        throw new Error(`There is no sprite map for ${spriteMapUri}`);
    }

    var coordinates = getCoordinatesForImage(spriteMap, spriteImage);
    var offset = {x: offsetX.getValue() || 0, y: offsetY.getValue() || 0};
    var position = `-${coordinates.x + offset.x}px -${coordinates.y + offset.y}px`;
    done(new sass.types.String(position));
}


function spriteInfoFromURL(url){
    var pattern = /((.+\/)?([^\*.]+))\/(.+?)\.png/;
    var matches = url.match(pattern);

    if (matches == null) {
        return null;
    }

    return {
        path: matches[1],
        name: matches[3]
    }
}


function createSpritesheet(config, spriteInfo, images, callback) {
    currentSprite = {config: config, spriteInfo: spriteInfo};

    spritesmith({src: images}, function (error, result) {
        if(error !== null){
            callback(error, null, null);
            return;
        }

        var spriteFile = spriteInfo.path + '.png';
        var imagePath =  path.join(config.generatedImagesPath, spriteFile);
        var spriteMap = createSpriteMap(spriteFile, images, result.coordinates);

        mkdirp(path.dirname(imagePath), function() {
            fs.writeFile(imagePath, result.image, "binary", function (err) {
                callback(err, spriteMap);
            });
        });
    });
}


function compassSpriteImporter(config, url, done){
    var imagesPath = path.join(config.imagesDir, url);
    glob(imagesPath, function(error, images){
        if(error !== null){
            done(error);
            return;
        }

        var spriteInfo = spriteInfoFromURL(url);
        if (spriteInfo === null) {
            done(new Error('This is not a valid spritesheet URL'));
            return;
        }

        createSpritesheet(config, spriteInfo, images, function(error, spriteMap){
            if(error !== null){
                done(error);
                return;
            }
            var templateContents = fs.readFileSync(
                path.join(__dirname, "sprite-template.scss"), "utf-8");
            var template = dot.template(templateContents);
            var spriteNames = {}, sprites = [];
            for (var i = 0; i < images.length; i++) {
                var imageName = path.basename(images[i],
                    path.extname(images[i]));
                spriteNames[imageName] = i;
                sprites.push(imageName);
            }
            var spriteName = path.basename(path.dirname(imagesPath));
            var data = {
                skipOverrides: false,
                spriteNames: spriteNames,
		dimensions: {'width': 0, 'height': 0},
                sprites: sprites,
                name: spriteName,
                uri: spriteMap.uri
            };
            var fileContents = template(data).replace(/\0/g, "\n");
            //fs.writeFileSync(`${spriteName}.scss`, fileContents);
            done({file: spriteMap.absolutePath, contents: fileContents});
        });
    });
}


function compassSpriteImporterWrapper(config){
    //TODO (gabriel-laet): define default config values
    var defaultConfig = {
        imagesDir: null,
        imagesPath: null,
        httpImagesPath: null,
	generatedImagesHttpPath: null,
        generatedImagesDir: null,
        generatedImagesPath: null,
        httpGeneratedImagesPath: null
    };

    var spritesConfig = config !== null ? {} : defaultConfig;
    if (spritesConfig !== defaultConfig) {
        for (var key in defaultConfig) {
            if (!defaultConfig.hasOwnProperty(key)) {
                continue;
            }
            spritesConfig[key] = config[key] || defaultConfig[key];
        }
    }

    return function(url, prev, done) {
        if (!glob.hasMagic(url)){
            if (done !== null){
                done(null);
            }
            return null;
        }
        try {
            compassSpriteImporter(spritesConfig, url, done);
        }catch(error){
            done(error);
        }
    };
}


module.exports.importer = compassSpriteImporterWrapper;
module.exports.functions = {
    'sprite-map($uri, ...)': spriteMap,
    'sprite-url($map)': spriteURL,
    'sprite-map-name($map)': spriteMapName,
    'sprite-position($map, $sprite, $offsetX, $offsetY)': spritePosition,
    'sprite-width($map, $sprite)': spriteDimensionWrapper('width'),
    'sprite-height($map, $sprite)': spriteDimensionWrapper('height'),
    'sprite-file($map, $sprite)': spriteFile,
    'image-width($img)': imageDimensionWrapper('width'),
    'image-height($img)': imageDimensionWrapper('height'),
    'image-url($imagePath, ...)': imageURL,
    'sprite_has_selector($map, $sprite, $selector)': spriteHasSelector
};
